"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { CampusSelect, Field, ResourcePicker } from "@/components/shared/fields";
import { api, errorMessage, uploadToSigned } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";

interface Category { id: string; name: string; default_priority: string }

export function NewIssueForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { campuses } = useSession();
  const [campusId, setCampusId] = useState<string | null>(params.get("campus") ?? (campuses.length === 1 ? campuses[0].id : null));
  const [locationId, setLocationId] = useState<string | null>(params.get("location"));
  const [assetId] = useState<string | null>(params.get("asset"));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const { data: categories = [] } = useQuery({ queryKey: ["issue-categories", "active"], queryFn: () => api<Category[]>("/issue-categories?active=true&limit=100") });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campusId && !locationId) return toast.error("Choose a campus or location");
    setBusy(true);
    try {
      const issue = await api<{ id: string; number: string }>("/issues", {
        body: {
          campus_id: campusId ?? undefined, location_id: locationId ?? undefined, asset_id: assetId ?? undefined, category_id: categoryId ?? undefined,
          title, description: description || undefined, priority: priority || undefined, source: window.innerWidth < 768 ? "mobile" : "web",
        },
        idempotencyKey: crypto.randomUUID(),
      });
      for (const p of photos) {
        const up = await api<{ upload: { url: string } }>("/attachments", {
          body: { entity_type: "issue", entity_id: issue.id, file_name: p.name, mime_type: p.type || "image/jpeg", size_bytes: p.size, kind: "photo" },
        });
        await uploadToSigned(up.upload.url, p);
      }
      toast.success(`Issue ${issue.number} reported`);
      router.push(`/facility/issues/${issue.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-4">
        {campuses.length > 1 && (
          <Field label="Campus" required={!locationId}>
            <CampusSelect value={campusId} onChange={(v) => { setCampusId(v); setLocationId(null); }} />
          </Field>
        )}
        <Field label="Where is it?" hint="Building, floor or room">
          <ResourcePicker
            endpoint="/locations"
            extraParams={campusId ? `&campus_id=${campusId}` : ""}
            value={locationId}
            onChange={(v) => setLocationId(v as string | null)}
            placeholder="Search locations…"
          />
        </Field>
        <Field label="What kind of problem?">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {categories.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => setCategoryId(c.id === categoryId ? null : c.id)}
                className={cn(
                  "rounded-md border px-2 py-2.5 text-sm transition-colors",
                  c.id === categoryId ? "border-primary bg-accent font-medium text-accent-foreground" : "hover:bg-muted",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Short title" required htmlFor="title">
          <Input id="title" required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tap leaking in washroom" />
        </Field>
        <Field label="Details" htmlFor="desc">
          <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Anything that helps the team fix it faster" />
        </Field>
        <Field label="Urgency" hint="Leave as default to use the category's priority">
          <div className="flex flex-wrap gap-2">
            {[["", "Default"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["critical", "Critical"]].map(([v, l]) => (
              <button
                type="button"
                key={v}
                onClick={() => setPriority(v)}
                className={cn("rounded-full border px-3 py-1 text-sm", priority === v ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted")}
              >
                {l}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Photos" hint="Up to 3">
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <span key={i} className="relative size-20 overflow-hidden rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={URL.createObjectURL(p)} alt="" className="size-full object-cover" />
                <button type="button" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white" aria-label="Remove photo">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {photos.length < 3 && (
              <button type="button" onClick={() => file.current?.click()} className="flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted">
                <Camera className="size-5" /> Add
              </button>
            )}
          </div>
          <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && setPhotos([...photos, e.target.files[0]].slice(0, 3))} />
        </Field>
      </Card>
      <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto sm:self-end">
        Submit issue
      </Button>
    </form>
  );
}

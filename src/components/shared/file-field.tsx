"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage, uploadToSigned } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

/**
 * One document for a form field: uploads straight away (to the record in
 * `upload`) and keeps the attachment id as the field's value.
 */
export function FileField({ upload, value, onChange, id }: { upload: { entityType: string; entityId: string; kind?: string }; value: string | null | undefined; onChange: (v: string | null) => void; id?: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const res = await api<{ attachment: { id: string }; upload: { url: string } }>("/attachments", {
        body: { entity_type: upload.entityType, entity_id: upload.entityId, file_name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size, kind: upload.kind },
      });
      await uploadToSigned(res.upload.url, file);
      setName(file.name);
      onChange(res.attachment.id);
      qc.invalidateQueries({ queryKey: ["attachments", upload.entityType, upload.entityId] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input ref={input} id={id} type="file" className="hidden" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={(e) => pick(e.target.files?.[0])} />
      {value ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{name ?? t("shared.file.attached")}</span>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setName(null); onChange(null); }} aria-label={t("shared.file.remove")}>
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => input.current?.click()}>
          <Paperclip /> {t("shared.file.choose")}
        </Button>
      )}
    </div>
  );
}

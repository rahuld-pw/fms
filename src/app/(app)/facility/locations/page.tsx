"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Building, ChevronRight, DoorOpen, Layers, MapPin, Plus, Printer, QrCode } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { CampusSelect } from "@/components/shared/fields";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog } from "@/components/shared/resource-form";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { printLabels } from "../assets/labels";

interface Node { id: string; name: string; type: string; code: string | null; campus_id: string; qr_token: string; children: Node[] }
const ICON: Record<string, React.ComponentType<{ className?: string }>> = { building: Building, floor: Layers, room: DoorOpen, area: MapPin };
const CHILD_TYPES: Record<string, string[]> = { building: ["floor", "room", "area"], floor: ["room", "area"], area: ["room", "area"], room: [] };

export default function LocationsPage() {
  const { t } = useT();
  const { campuses } = useSession();
  const can = useCan();
  const [campus, setCampus] = useState<string | null>(campuses[0]?.id ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<{ parent?: Node } | null>(null);
  const { data: tree, isLoading } = useQuery({ queryKey: ["/locations", "tree", campus], queryFn: () => api<Node[]>(`/locations/tree${campus ? `?campus_id=${campus}` : ""}`) });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const parentTypes = creating?.parent ? CHILD_TYPES[creating.parent.type] : ["building", "area"];
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t("facility.locations.title")}
        description={t("facility.locations.description")}
        actions={
          <>
            {selected.size > 0 && (
              <Button variant="outline" size="sm" onClick={() => printLabels("location", [...selected])}>
                <Printer /> {t("facility.locations.printLabels", { n: selected.size })}
              </Button>
            )}
            {can("location:create", { campusId: campus }, "auto") && (
              <Button size="sm" onClick={() => setCreating({})}>
                <Plus /> {t("facility.locations.buildingArea")}
              </Button>
            )}
          </>
        }
      />
      {campuses.length > 1 && <div className="mb-3 w-full sm:w-64"><CampusSelect value={campus} onChange={setCampus} /></div>}
      {isLoading && <Skeleton className="h-64" />}
      {tree?.length === 0 && <EmptyState icon={MapPin} title={t("facility.locations.emptyTitle")} description={t("facility.locations.emptyDesc")} />}
      {tree && tree.length > 0 && (
        <Card className="p-2">
          <ul>{tree.map((n) => <TreeNode key={n.id} node={n} depth={0} selected={selected} onToggle={toggle} onAdd={(p) => setCreating({ parent: p })} canAdd={can("location:create", { campusId: campus }, "auto")} />)}</ul>
        </Card>
      )}
      <ResourceFormDialog
        open={!!creating}
        onOpenChange={(o) => !o && setCreating(null)}
        title={creating?.parent ? t("facility.locations.addInside", { name: creating.parent.name }) : t("facility.locations.addBuilding")}
        endpoint="/locations"
        fields={[
          { name: "name", label: t("ui.name"), required: true },
          { name: "type", label: t("ui.type"), type: "select", required: true, options: parentTypes.map((v) => ({ value: v, label: t(`enum.locationType.${v}`, undefined, v[0].toUpperCase() + v.slice(1)) })) },
          { name: "code", label: t("ui.code"), hint: t("facility.locations.codeHint") },
          { name: "capacity", label: t("facility.locations.capacity"), type: "number" },
          { name: "description", label: t("ui.description"), type: "textarea" },
        ]}
        defaultValues={{ type: parentTypes[0] }}
        transform={(v) => ({ ...v, campus_id: creating?.parent?.campus_id ?? campus, parent_id: creating?.parent?.id ?? null })}
        invalidate={["/locations"]}
      />
    </div>
  );
}

function TreeNode({ node, depth, selected, onToggle, onAdd, canAdd }: { node: Node; depth: number; selected: Set<string>; onToggle: (id: string) => void; onAdd: (n: Node) => void; canAdd: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(depth < 1);
  const Icon = ICON[node.type] ?? MapPin;
  return (
    <li>
      <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60" style={{ paddingLeft: 8 + depth * 20 }}>
        <button onClick={() => setOpen(!open)} className={cn("rounded p-0.5", node.children.length === 0 && "invisible")} aria-label={open ? t("facility.locations.collapse") : t("facility.locations.expand")}>
          <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        </button>
        <Checkbox checked={selected.has(node.id)} onCheckedChange={() => onToggle(node.id)} aria-label={t("facility.locations.selectNode", { name: node.name })} />
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm">{node.name}</span>
        {node.code && <span className="font-mono text-xs text-muted-foreground">{node.code}</span>}
        <div className="ml-auto flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          <Button variant="ghost" size="xs" asChild>
            <Link href={`/facility/issues?location_id=${node.id}`}>{t("facility.issues.title")}</Link>
          </Button>
          <Button variant="ghost" size="icon-sm" asChild aria-label={t("facility.locations.qrCode")}>
            <a href={`/api/v1/qr/${node.qr_token}/svg`} target="_blank" rel="noreferrer"><QrCode /></a>
          </Button>
          {canAdd && CHILD_TYPES[node.type]?.length > 0 && (
            <Button variant="ghost" size="icon-sm" onClick={() => onAdd(node)} aria-label={t("facility.locations.addInside", { name: node.name })}>
              <Plus />
            </Button>
          )}
        </div>
      </div>
      {open && node.children.length > 0 && (
        <ul>{node.children.map((c) => <TreeNode key={c.id} node={c} depth={depth + 1} selected={selected} onToggle={onToggle} onAdd={onAdd} canAdd={canAdd} />)}</ul>
      )}
    </li>
  );
}

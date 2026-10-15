"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Building, ChevronRight, DoorOpen, Layers, MapPin, Plus, Printer, QrCode } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
  const [q, setQ] = useState("");
  const { data: tree, isLoading } = useQuery({ queryKey: ["/locations", "tree", campus], queryFn: () => api<Node[]>(`/locations/tree${campus ? `?campus_id=${campus}` : ""}`) });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const campusName = campuses.length > 1 ? campuses.find((c) => c.id === campus)?.name : undefined;
  // every place with the names above it, for search results
  const flat = useMemo(() => {
    const out: { node: Node; trail: string[] }[] = [];
    const walk = (n: Node, trail: string[]) => { out.push({ node: n, trail }); n.children.forEach((c) => walk(c, [...trail, n.name])); };
    (tree ?? []).forEach((n) => walk(n, []));
    return out;
  }, [tree]);
  const term = q.trim().toLowerCase();
  const matches = term ? flat.filter(({ node }) => node.name.toLowerCase().includes(term) || node.code?.toLowerCase().includes(term)) : [];
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
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        {campuses.length > 1 && <div className="w-full sm:w-64"><CampusSelect value={campus} onChange={setCampus} /></div>}
        {(tree?.length ?? 0) > 0 && <Input className="sm:max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui.search")} aria-label={t("ui.search")} />}
      </div>
      {isLoading && <Skeleton className="h-64" />}
      {tree?.length === 0 && <EmptyState icon={MapPin} title={t("facility.locations.emptyTitle")} description={t("facility.locations.emptyDesc")} />}
      {tree && tree.length > 0 && term && (
        <Card className="p-2">
          {matches.length === 0 && <p className="p-2 text-sm text-muted-foreground">{t("ui.noResults")}</p>}
          <ul>
            {matches.map(({ node, trail }) => (
              <NodeRow key={node.id} node={node} depth={0} trail={[...(campusName ? [campusName] : []), ...trail]} showTrail selected={selected} onToggle={toggle} onAdd={(p) => setCreating({ parent: p })} canAdd={can("location:create", { campusId: campus }, "auto")} />
            ))}
          </ul>
        </Card>
      )}
      {tree && tree.length > 0 && !term && (
        <Card className="p-2">
          <ul>{tree.map((n) => <TreeNode key={n.id} node={n} depth={0} trail={campusName ? [campusName] : []} selected={selected} onToggle={toggle} onAdd={(p) => setCreating({ parent: p })} canAdd={can("location:create", { campusId: campus }, "auto")} />)}</ul>
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

interface RowProps { node: Node; depth: number; trail: string[]; selected: Set<string>; onToggle: (id: string) => void; onAdd: (n: Node) => void; canAdd: boolean }

function TreeNode(props: RowProps) {
  const { node, depth, trail } = props;
  const [open, setOpen] = useState(depth < 1);
  return (
    <li>
      <NodeRow {...props} open={open} onOpenToggle={() => setOpen(!open)} />
      {open && node.children.length > 0 && (
        <ul>{node.children.map((c) => <TreeNode key={c.id} {...props} node={c} depth={depth + 1} trail={[...trail, node.name]} />)}</ul>
      )}
    </li>
  );
}

/**
 * One place. Deeper levels are indented less on phones, and there the names
 * above it are shown underneath (campus › building › floor) so a room is
 * never just "Room 101".
 */
function NodeRow({ node, depth, trail, selected, onToggle, onAdd, canAdd, open, onOpenToggle, showTrail }: RowProps & { open?: boolean; onOpenToggle?: () => void; showTrail?: boolean }) {
  const { t } = useT();
  const Icon = ICON[node.type] ?? MapPin;
  const Row = onOpenToggle ? "div" : "li";
  return (
    <Row
      className="group flex items-center gap-2 rounded-md py-1.5 pr-2 pl-[calc(8px+var(--d)*12px)] hover:bg-muted/60 sm:pl-[calc(8px+var(--d)*20px)]"
      style={{ "--d": depth } as React.CSSProperties}
    >
      {onOpenToggle ? (
        <button onClick={onOpenToggle} className={cn("rounded p-0.5", node.children.length === 0 && "invisible")} aria-label={open ? t("facility.locations.collapse") : t("facility.locations.expand")}>
          <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        </button>
      ) : null}
      <Checkbox checked={selected.has(node.id)} onCheckedChange={() => onToggle(node.id)} aria-label={t("facility.locations.selectNode", { name: node.name })} />
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="min-w-0 break-words text-sm">{node.name}</span>
          {node.code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{node.code}</span>}
        </span>
        {trail.length > 0 && (
          <span className={cn("break-words text-xs text-muted-foreground", !showTrail && "sm:hidden")}>{trail.join(" › ")}</span>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
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
    </Row>
  );
}

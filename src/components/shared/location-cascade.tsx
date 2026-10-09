"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { NativeSelect } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

interface Loc { id: string; name: string; type: string; parent_id: string | null; campus_id: string }

/**
 * Campus › building/area › floor/area › room/area: one dropdown per level of
 * the location tree. The value is the deepest location picked (or null for the
 * campus itself).
 */
export function LocationCascade({ campusId, value, onChange, id }: { campusId: string | null | undefined; value: string | null | undefined; onChange: (v: string | null) => void; id?: string }) {
  const [chain, setChain] = useState<string[]>([]);
  // ancestors of a location picked elsewhere (editing, or a QR code)
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (value === loadedFor || (value && chain[chain.length - 1] === value)) return;
    let cancelled = false;
    (async () => {
      const ids: string[] = [];
      let cur = value ?? null;
      for (let i = 0; cur && i < 10; i++) {
        const loc: Loc = await api<Loc>(`/locations/${cur}`).catch(() => null as never);
        if (!loc) break;
        ids.unshift(loc.id);
        cur = loc.parent_id;
      }
      if (!cancelled) {
        setChain(ids);
        setLoadedFor(value);
      }
    })();
    return () => { cancelled = true; };
  }, [value, loadedFor, chain]);
  // a different campus starts again from the top
  const campusRef = useRef(campusId);
  useEffect(() => {
    if (campusRef.current === campusId) return;
    const had = campusRef.current;
    campusRef.current = campusId;
    if (had && value) {
      setChain([]);
      setLoadedFor(null);
      onChange(null);
    }
  }, [campusId, value, onChange]);
  const pick = (level: number, v: string) => {
    const next = v ? [...chain.slice(0, level), v] : chain.slice(0, level);
    setChain(next);
    const leaf = next[next.length - 1] ?? null;
    setLoadedFor(leaf);
    onChange(leaf);
  };
  if (!campusId) return <NativeSelect id={id} disabled><option>—</option></NativeSelect>;
  return (
    <div className="flex flex-col gap-2">
      {[...chain, null].map((_, level) => (
        <Level key={`${level}-${chain[level - 1] ?? "root"}`} id={level === 0 ? id : undefined} campusId={campusId} parentId={level === 0 ? null : chain[level - 1]} value={chain[level] ?? ""} onPick={(v) => pick(level, v)} />
      ))}
    </div>
  );
}

function Level({ campusId, parentId, value, onPick, id }: { campusId: string; parentId: string | null; value: string; onPick: (v: string) => void; id?: string }) {
  const { t } = useT();
  const { data, isLoading } = useQuery({
    queryKey: ["location-level", campusId, parentId],
    queryFn: () => api<Loc[]>(`/locations?campus_id=${campusId}&parent_id=${parentId ?? "null"}&limit=200&sort=name`),
    staleTime: 60_000,
  });
  if (!isLoading && !data?.length) {
    return parentId ? null : <p className="text-xs text-muted-foreground">{t("shared.location.none")}</p>;
  }
  const types = [...new Set((data ?? []).map((l) => l.type))];
  const label = types.length === 1 ? t(`shared.location.pick.${types[0]}`) : t("shared.location.pick.any");
  return (
    <NativeSelect id={id} value={value} disabled={isLoading} onChange={(e) => onPick(e.target.value)} aria-label={label}>
      <option value="">{parentId ? t("shared.location.wholeParent") : t("shared.location.wholeCampus")} · {label}</option>
      {data?.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name} ({t(`enum.locationType.${l.type}`, undefined, l.type)})
        </option>
      ))}
    </NativeSelect>
  );
}

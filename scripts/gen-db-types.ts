/**
 * Generates src/lib/supabase/database.types.ts in the same shape as
 * `supabase gen types typescript`, by introspecting a Postgres database that
 * has the migrations applied (see scripts/db-test-reset.sh). Useful where the
 * Supabase CLI's Docker-based generator is unavailable (CI, sandboxes).
 *
 *   TEST_DATABASE_URL=postgres://... npx tsx scripts/gen-db-types.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/campus_ops_test";
const out = path.resolve(import.meta.dirname, "../src/lib/supabase/database.types.ts");

const scalar: Record<string, string> = {
  bool: "boolean",
  int2: "number",
  int4: "number",
  int8: "number",
  float4: "number",
  float8: "number",
  numeric: "number",
  text: "string",
  varchar: "string",
  bpchar: "string",
  uuid: "string",
  date: "string",
  time: "string",
  timestamp: "string",
  timestamptz: "string",
  interval: "string",
  json: "Json",
  jsonb: "Json",
  regclass: "unknown",
  regprocedure: "unknown",
  void: "undefined",
  record: "Json",
};

function tsType(udt: string): string {
  if (udt.startsWith("_")) return `${tsType(udt.slice(1))}[]`;
  return scalar[udt] ?? "unknown";
}

async function main() {
  const db = new Client({ connectionString: url });
  await db.connect();

  const cols = await db.query<{
    table_name: string;
    kind: string;
    column_name: string;
    udt_name: string;
    is_nullable: string;
    has_default: boolean;
    is_generated: boolean;
    is_identity: boolean;
  }>(`
    select c.relname as table_name, c.relkind as kind, a.attname as column_name, t.typname as udt_name,
      case when a.attnotnull then 'NO' else 'YES' end as is_nullable,
      a.atthasdef as has_default, a.attgenerated <> '' as is_generated, a.attidentity <> '' as is_identity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    join pg_type t on t.oid = a.atttypid
    where n.nspname = 'public' and c.relkind in ('r', 'v')
    order by c.relname, a.attnum`);

  const fks = await db.query<{
    name: string;
    table_name: string;
    columns: string[];
    ref_table: string;
    ref_columns: string[];
    one_to_one: boolean;
  }>(`
    select con.conname as name, c.relname as table_name,
      array(select attname from pg_attribute where attrelid = con.conrelid and attnum = any(con.conkey) order by attnum)::text[] as columns,
      rc.relname as ref_table,
      array(select attname from pg_attribute where attrelid = con.confrelid and attnum = any(con.confkey) order by attnum)::text[] as ref_columns,
      exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique
              and i.indkey::int2[] @> con.conkey and cardinality(i.indkey::int2[]) = cardinality(con.conkey)) as one_to_one
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class rc on rc.oid = con.confrelid
    join pg_namespace rn on rn.oid = rc.relnamespace
    where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
    order by c.relname, con.conname`);

  const fns = await db.query<{
    name: string;
    arg_names: string[] | null;
    arg_types: string[];
    arg_defaults: number;
    ret_type: string;
    retset: boolean;
    out_names: string[] | null;
    out_types: string[] | null;
    ret_rel: string | null;
  }>(`
    select p.proname as name, p.proargnames as arg_names,
      array(select t.typname from unnest(p.proargtypes) with ordinality x(oid, i) join pg_type t on t.oid = x.oid order by i)::text[] as arg_types,
      p.pronargdefaults as arg_defaults, rt.typname as ret_type, p.proretset as retset,
      case when p.proargmodes is not null then
        array(select p.proargnames[i] from generate_subscripts(p.proargmodes, 1) i where p.proargmodes[i] in ('o', 't'))::text[] end as out_names,
      case when p.proargmodes is not null then
        array(select t.typname from generate_subscripts(p.proargmodes, 1) i join pg_type t on t.oid = p.proallargtypes[i]
              where p.proargmodes[i] in ('o', 't') order by i)::text[] end as out_types,
      (select rc.relname from pg_class rc where rc.oid = rt.typrelid and rt.typrelid <> 0) as ret_rel
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type rt on rt.oid = p.prorettype
    where n.nspname = 'public' and p.prokind = 'f'
      and rt.typname not in ('trigger', 'event_trigger')
    order by p.proname`);

  await db.end();

  const tables = new Map<string, { kind: string; cols: typeof cols.rows }>();
  for (const c of cols.rows) {
    if (!tables.has(c.table_name)) tables.set(c.table_name, { kind: c.kind, cols: [] });
    tables.get(c.table_name)!.cols.push(c);
  }

  const relationships = (table: string) =>
    fks.rows
      .filter((f) => f.table_name === table)
      .map(
        (f) => `          {
            foreignKeyName: ${JSON.stringify(f.name)}
            columns: ${JSON.stringify(f.columns)}
            isOneToOne: ${f.one_to_one}
            referencedRelation: ${JSON.stringify(f.ref_table)}
            referencedColumns: ${JSON.stringify(f.ref_columns)}
          },`,
      )
      .join("\n");

  const rowType = (cs: typeof cols.rows, mode: "Row" | "Insert" | "Update", isView: boolean) =>
    cs
      .filter((c) => mode === "Row" || !c.is_generated)
      .map((c) => {
        const nullable = c.is_nullable === "YES" || isView;
        const t = tsType(c.udt_name) + (nullable ? " | null" : "");
        const optional =
          mode === "Update" || (mode === "Insert" && (nullable || c.has_default || c.is_identity));
        return `          ${c.column_name}${optional ? "?" : ""}: ${t}`;
      })
      .join("\n");

  const tableBlocks: string[] = [];
  const viewBlocks: string[] = [];
  for (const [name, t] of tables) {
    if (t.kind === "r") {
      tableBlocks.push(`      ${name}: {
        Row: {
${rowType(t.cols, "Row", false)}
        }
        Insert: {
${rowType(t.cols, "Insert", false)}
        }
        Update: {
${rowType(t.cols, "Update", false)}
        }
        Relationships: [
${relationships(name)}
        ]
      }`);
    } else {
      viewBlocks.push(`      ${name}: {
        Row: {
${rowType(t.cols, "Row", true)}
        }
        Relationships: []
      }`);
    }
  }

  // Group overloads by name
  const fnGroups = new Map<string, typeof fns.rows>();
  for (const f of fns.rows) {
    if (!fnGroups.has(f.name)) fnGroups.set(f.name, []);
    fnGroups.get(f.name)!.push(f);
  }
  const fnBlocks: string[] = [];
  for (const [name, overloads] of fnGroups) {
    const variants = overloads.map((f) => {
      const n = f.arg_types.length;
      const args = f.arg_types
        .map((t, i) => {
          const argName = f.arg_names?.[i] ?? `arg${i}`;
          const optional = i >= n - f.arg_defaults;
          return `${argName}${optional ? "?" : ""}: ${tsType(t)}`;
        })
        .join("; ");
      let ret: string;
      if (f.out_names && f.out_names.length > 0 && f.out_types) {
        const shape = f.out_names.map((o, i) => `${o}: ${tsType(f.out_types![i])}`).join("; ");
        ret = `{ ${shape} }[]`;
      } else if (f.ret_rel) {
        const rel = tables.get(f.ret_rel);
        const shape = rel ? rel.cols.map((c) => `${c.column_name}: ${tsType(c.udt_name)}${c.is_nullable === "YES" ? " | null" : ""}`).join("; ") : "Json";
        ret = f.retset ? `{ ${shape} }[]` : `{ ${shape} }`;
      } else {
        ret = tsType(f.ret_type) + (f.retset ? "[]" : "");
      }
      return `{ Args: ${args ? `{ ${args} }` : "never"}; Returns: ${ret} }`;
    });
    fnBlocks.push(`      ${name}:\n        | ${variants.join("\n        | ")}`);
  }

  const src = `// Generated by scripts/gen-db-types.ts — do not edit by hand.
// Equivalent to \`supabase gen types typescript\` for the public schema.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12"
  }
  public: {
    Tables: {
${tableBlocks.join("\n")}
    }
    Views: {
${viewBlocks.join("\n")}
    }
    Functions: {
${fnBlocks.join("\n")}
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"]
export type TableName = keyof PublicSchema["Tables"]
`;
  writeFileSync(out, src);
  console.log(`wrote ${out} (${tables.size} relations, ${fnGroups.size} functions)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

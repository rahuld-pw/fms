// Shared by server and client: flat "a.b.c" keys, {name} placeholders,
// English fallback for anything a language hasn't translated yet.

export type Dict = { [key: string]: string | Dict };
export type FlatDict = Record<string, string>;
export type Vars = Record<string, string | number>;

export function flatten(dict: Dict, prefix = "", out: FlatDict = {}): FlatDict {
  for (const [k, v] of Object.entries(dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

export function interpolate(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

export function makeT(messages: FlatDict) {
  return (key: string, vars?: Vars, fallback?: string) => interpolate(messages[key] ?? fallback ?? key, vars);
}
export type TFunction = ReturnType<typeof makeT>;

"use client";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ListMeta {
  has_more: boolean;
  next_cursor: string | null;
  total?: number;
  page?: number;
  limit: number;
}

/** Calls /api/v1 with the browser session; returns `data` (or the whole list envelope with `list: true`). */
export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      // session expired: outside React, so a hard navigation is the only option here
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiClientError(res.status, json?.error?.code ?? "error", json?.error?.message ?? res.statusText, json?.error?.details);
  }
  return json?.data as T;
}

export async function apiList<T = unknown>(path: string, signal?: AbortSignal): Promise<{ data: T[]; meta: ListMeta }> {
  const res = await fetch(`/api/v1${path}`, { signal, credentials: "same-origin" });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiClientError(res.status, json?.error?.code ?? "error", json?.error?.message ?? res.statusText);
  return json;
}

export const errorMessage = (e: unknown) =>
  e instanceof ApiClientError
    ? e.code === "validation_failed" && Array.isArray(e.details)
      ? (e.details as { path: string; message: string }[]).map((d) => `${d.path}: ${d.message}`).join("; ")
      : e.message
    : e instanceof Error
      ? e.message
      : "Something went wrong";

/** Uploads a file to a signed upload URL returned by POST /attachments or the public endpoints. */
export async function uploadToSigned(url: string, file: File) {
  const target = url.startsWith("http") ? url : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${url}`;
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);
  const res = await fetch(target, { method: "PUT", body: form, headers: { "x-upsert": "false" } });
  if (!res.ok) throw new Error("Upload failed");
}

/** Builds a query string from an object, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Fetches a file (e.g. a CSV export) and saves it via a temporary link, so the
 * caller can show a busy state until the download is ready.
 */
export async function downloadFile(url: string, fallbackName = "download") {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new ApiClientError(res.status, json?.error?.code ?? "error", json?.error?.message ?? res.statusText);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = decodeURIComponent(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

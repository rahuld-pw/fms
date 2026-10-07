"use client";

/** Calls the vendor-portal API with the magic-link token. */
export async function portal<T = unknown>(token: string, path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(`/api/v1/portal${path}`, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { authorization: `VendorToken ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const details = Array.isArray(json?.error?.details) ? `: ${json.error.details.map((d: { path: string; message: string }) => `${d.path} ${d.message}`).join("; ")}` : "";
    throw new Error((json?.error?.message ?? "Something went wrong") + details);
  }
  return json?.data as T;
}

export async function putSigned(url: string, file: File) {
  const target = url.startsWith("http") ? url : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${url}`;
  const form = new FormData();
  form.append("", file);
  const res = await fetch(target, { method: "PUT", body: form });
  if (!res.ok) throw new Error("Upload failed");
}

import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

/** Completes magic-link / email-confirmation sign-in (PKCE code exchange). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  if (code) {
    const db = await createUserClient();
    await db.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", req.url));
}

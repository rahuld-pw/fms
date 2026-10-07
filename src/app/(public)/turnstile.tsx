"use client";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
export const captchaEnabled = !!SITE_KEY;

/** Cloudflare Turnstile widget. Renders nothing when no site key is configured (local dev). */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  useEffect(() => {
    cb.current = onToken;
  });
  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    let id: string | undefined;
    const render = () => {
      if (!window.turnstile || !ref.current) return;
      id = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY, appearance: "interaction-only",
        callback: (t: string) => cb.current(t), "expired-callback": () => cb.current(null), "error-callback": () => cb.current(null),
      });
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => { if (id && window.turnstile) window.turnstile.remove(id); };
  }, []);
  return SITE_KEY ? <div ref={ref} className="min-h-0" /> : null;
}

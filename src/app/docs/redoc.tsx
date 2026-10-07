"use client";
import Script from "next/script";

export function Redoc() {
  return (
    <>
      <div id="redoc" className="min-h-dvh bg-white" />
      <Script
        src="https://cdn.jsdelivr.net/npm/redoc@2.4.0/bundles/redoc.standalone.js"
        strategy="afterInteractive"
        onReady={() =>
          (window as unknown as { Redoc?: { init: (url: string, opts: object, el: HTMLElement | null) => void } }).Redoc?.init(
            "/api/v1/openapi.json",
            { theme: { colors: { primary: { main: "#15803d" } } } },
            document.getElementById("redoc"),
          )
        }
      />
    </>
  );
}

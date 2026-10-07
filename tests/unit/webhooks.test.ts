import { describe, expect, it } from "vitest";
import { sha256Hex, signPayload, verifySignature } from "../../supabase/functions/_shared/signature";
import { render } from "../../supabase/functions/_shared/templates";

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "e1", type: "issue.created", data: { number: "ISS-1" } });

  it("signs with t=<ts>,v1=<hmac> and verifies", async () => {
    const header = await signPayload(secret, body, 1_760_000_000);
    expect(header).toMatch(/^t=1760000000,v1=[0-9a-f]{64}$/);
    expect(await verifySignature(secret, body, header, 300, 1_760_000_100)).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets and stale timestamps", async () => {
    const header = await signPayload(secret, body, 1_760_000_000);
    expect(await verifySignature(secret, body.replace("ISS-1", "ISS-2"), header, 300, 1_760_000_000)).toBe(false);
    expect(await verifySignature("other", body, header, 300, 1_760_000_000)).toBe(false);
    expect(await verifySignature(secret, body, header, 300, 1_760_000_301)).toBe(false);
    expect(await verifySignature(secret, body, null)).toBe(false);
  });

  it("hashes tokens like the server (sha256 hex)", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("message templates", () => {
  const ctx = { appUrl: "https://ops.example.com", org: "Greenfield School" };

  it("makes notification links absolute", () => {
    const r = render({ channel: "email", template: "notification", subject: "Approval needed", payload: { title: "Approval needed", body: "PO/1", link: "/approvals" } }, ctx);
    expect(r.subject).toBe("Approval needed");
    expect(r.html).toContain('href="https://ops.example.com/approvals"');
    expect(r.text).toContain("https://ops.example.com/approvals");
  });

  it("escapes HTML from payloads", () => {
    const r = render({ channel: "email", template: "notification", subject: null, payload: { title: "<script>x</script>", body: "a & b" } }, ctx);
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("a &amp; b");
  });

  it("adds the vendor portal link and WhatsApp template parameters", () => {
    const r = render(
      { channel: "whatsapp", template: "vendor_booking_reminder", subject: null, payload: { number: "WO-7", scheduled_for: "2026-10-09T04:30:00Z" } },
      { ...ctx, portalLink: "https://ops.example.com/vendor-portal?token=t" },
    );
    expect(r.whatsapp?.name).toBe("vendor_booking_reminder");
    expect(r.whatsapp?.params[0]).toBe("WO-7");
    expect(r.text).toContain("vendor-portal?token=t");
  });
});

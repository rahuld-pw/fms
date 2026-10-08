import { afterEach, describe, expect, it } from "vitest";
import { isPushEndpoint } from "@/lib/push/endpoint";

describe("push endpoints", () => {
  afterEach(() => {
    delete process.env.PUSH_ALLOW_LOCAL_ENDPOINTS;
  });

  it("accepts the browser push services", () => {
    for (const u of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx",
      "https://wns2-pn1p.notify.windows.com/w/?token=abc",
    ]) expect(isPushEndpoint(u), u).toBe(true);
  });

  it("rejects anything else, so the server can't be pointed at other hosts", () => {
    for (const u of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.test/x",
      "https://evilpush.apple.com.attacker.test/x",
      "https://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/push",
      "not a url",
    ]) expect(isPushEndpoint(u), u).toBe(false);
  });

  it("allows a local test push service only when switched on", () => {
    process.env.PUSH_ALLOW_LOCAL_ENDPOINTS = "1";
    expect(isPushEndpoint("https://127.0.0.1:9911/push")).toBe(true);
    expect(isPushEndpoint("http://127.0.0.1:9911/push")).toBe(false);
  });
});

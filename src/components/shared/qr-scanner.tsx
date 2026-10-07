"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Extracts the QR token from a scanned value (full /q/<token> URL or the bare token). */
export function tokenFromScan(raw: string) {
  const m = raw.match(/\/q\/([A-Za-z0-9_-]+)/);
  return (m ? m[1] : raw).trim();
}

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/**
 * Camera QR scanner using the browser BarcodeDetector API (Android Chrome,
 * Safari 17+). Falls back to typing/pasting the code where unsupported.
 */
const noop = () => () => {};

export function QrScanner({ onScan, paused }: { onScan: (token: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const detectable = useSyncExternalStore(
    noop,
    () => "BarcodeDetector" in window && !!navigator.mediaDevices,
    () => true,
  );
  const supported = detectable && !cameraFailed;
  const [manual, setManual] = useState("");
  const last = useRef<{ v: string; t: number }>({ v: "", t: 0 });

  useEffect(() => {
    if (!active || paused) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = new Ctor({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current || stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            const v = codes[0]?.rawValue;
            if (v && (v !== last.current.v || Date.now() - last.current.t > 3000)) {
              last.current = { v, t: Date.now() };
              navigator.vibrate?.(60);
              onScan(tokenFromScan(v));
            }
          } catch {
            /* frame not ready */
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setActive(false);
        setCameraFailed(true);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, paused, onScan]);

  return (
    <div className="flex flex-col gap-3">
      {supported && (
        <div className="relative overflow-hidden rounded-lg border bg-black">
          <video ref={video} className="aspect-square w-full object-cover sm:aspect-video" muted playsInline />
          {!active && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Button onClick={() => setActive(true)}>
                <Camera /> Start camera
              </Button>
            </div>
          )}
          {active && <div className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80" />}
        </div>
      )}
      {active && (
        <Button variant="outline" size="sm" onClick={() => setActive(false)} className="self-start">
          <CameraOff /> Stop camera
        </Button>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onScan(tokenFromScan(manual));
          setManual("");
        }}
      >
        <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={supported ? "…or type / paste the code" : "Type or paste the code under the QR"} />
        <Button type="submit" variant="outline">Go</Button>
      </form>
    </div>
  );
}

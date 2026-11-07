import { useEffect, useRef, useState } from "react";
import { Camera, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** Native BarcodeDetector camera scan (HTTPS required) + manual fallback. */
export function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stop = false;
    (async () => {
      try {
        const BD = (window as unknown as { BarcodeDetector?: new (o: object) => Detector })
          .BarcodeDetector;
        if (!BD)
          throw new Error(
            "Scan caméra non supporté par ce navigateur. Saisissez le code manuellement.",
          );
        if (!window.isSecureContext) throw new Error("La caméra nécessite HTTPS.");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const det = new BD({ formats: ["qr_code"] });
        const tick = async () => {
          if (stop || !video.current) return;
          try {
            const r = await det.detect(video.current);
            if (r[0]) {
              onCode(r[0].rawValue);
              setActive(false);
              return;
            }
          } catch {
            /* frame */
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Caméra indisponible.");
        setActive(false);
      }
    })();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, onCode]);

  return (
    <div className="space-y-3">
      {active ? (
        <div className="relative overflow-hidden rounded-lg bg-primary">
          <video ref={video} className="aspect-square w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-10 rounded-lg border-2 border-accent" />
          <Button
            variant="secondary"
            className="absolute bottom-3 left-1/2 -translate-x-1/2"
            onClick={() => setActive(false)}
          >
            Arrêter
          </Button>
        </div>
      ) : (
        <Button
          size="lg"
          className="h-14 w-full text-base"
          onClick={() => {
            setErr(null);
            setActive(true);
          }}
        >
          <Camera /> Scanner un QR code
        </Button>
      )}
      {err && (
        <p role="alert" className="text-sm text-bad">
          {err}
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onCode(manual.trim());
        }}
      >
        <div className="relative flex-1">
          <Keyboard className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Code inventaire ou jeton QR"
            placeholder="Code (ex. CAM-001) ou jeton QR"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            className="h-12 pl-9 font-mono"
          />
        </div>
        <Button type="submit" variant="outline" className="h-12">
          Valider
        </Button>
      </form>
    </div>
  );
}

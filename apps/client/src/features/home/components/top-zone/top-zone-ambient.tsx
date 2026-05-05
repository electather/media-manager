import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

const FADE_DELAY_MS = 20;
const FADE_OUT_MS = 900;

type Layer = { id: number; src: string; visible: boolean };

/**
 * Crossfading blurred backdrop. Sits behind the hero card and bleeds outside
 * the card via blur + upscale, producing the YouTube-style ambient spill.
 * Translates by the parent's `--ambient-y` custom property so the page scroll
 * drives a parallax effect. The inner wrapper is oversized so the parallax
 * shift cannot expose an uncovered card edge.
 */
export function TopZoneAmbient({ src }: { src: string | undefined }) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (!src) return;
    const id = ++idRef.current;
    setLayers((prev) => [...prev.slice(-1), { id, src, visible: false }]);
    const showTimer = window.setTimeout(() => {
      setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: true } : l)));
    }, FADE_DELAY_MS);
    const cleanupTimer = window.setTimeout(() => {
      setLayers((prev) => prev.filter((l) => l.id >= id));
    }, FADE_OUT_MS);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(cleanupTimer);
    };
  }, [src]);

  return (
    <div
      aria-hidden="true"
      data-testid="top-zone-ambient"
      className="pointer-events-none absolute inset-0 z-0"
    >
      <div
        className="absolute inset-[-9%]"
        style={{ transform: "translateY(calc(var(--ambient-y, 0px) * -1))" }}
      >
        {layers.map((layer) => (
          <img
            key={layer.id}
            src={layer.src}
            alt=""
            className={cn(
              "absolute inset-0 size-full scale-[1.18] object-cover blur-[80px] saturate-[1.9] transition-opacity duration-700 ease-out",
              layer.visible ? "opacity-90" : "opacity-0",
            )}
          />
        ))}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

const FADE_DELAY_MS = 20;
const FADE_OUT_MS = 900;

type Layer = { id: number; src: string; visible: boolean };

/**
 * Crossfading backdrop image stack. Translates by the parent's `--ambient-y`
 * custom property so the page scroll drives a parallax effect on the hero.
 * The image is oversized to 110% to keep edges clean during translation.
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
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className="absolute -inset-[5%]"
        style={{ transform: "translateY(calc(var(--ambient-y, 0px) * -1))" }}
      >
        {layers.map((layer) => (
          <img
            key={layer.id}
            src={layer.src}
            alt=""
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-700 ease-out",
              layer.visible ? "opacity-100" : "opacity-0",
            )}
          />
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/40 to-transparent" />
    </div>
  );
}

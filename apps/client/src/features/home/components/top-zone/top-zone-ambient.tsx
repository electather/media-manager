import { cn } from "@/shared/lib/utils";
import { useEffect, useRef, useState, startTransition } from "react";

const FADE_OUT_MS = 900;

type Layer = { id: number; src: string };

/**
 * Crossfading blurred backdrop. Sits behind the hero card and bleeds outside
 * the card via blur + upscale, producing the YouTube-style ambient spill.
 * The radial mask fades the bleed to transparent well within the stage so no
 * hard edge appears at the section bounds.
 */
export function TopZoneAmbient({ src }: { src: string | undefined }) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (!src) return;
    const id = ++idRef.current;
    startTransition(() => {
      setLayers((prev) => [...prev.slice(-1), { id, src }]);
    });
    const timer = window.setTimeout(() => {
      setLayers((prev) => prev.filter((l) => l.id >= id));
    }, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [src]);

  const activeLayerId = layers.at(-1)?.id;

  return (
    <div
      aria-hidden="true"
      data-testid="top-zone-ambient"
      className="pointer-events-none select-none absolute inset-x-0 -top-32 -bottom-32"
    >
      {layers.map((layer) => (
        <img
          key={layer.id}
          src={layer.src}
          alt=""
          fetchPriority="low"
          decoding="async"
          className={cn(
            "absolute inset-0 size-full transform-gpu object-cover blur-[110px] saturate-[1.9] transition-opacity duration-700 ease-out backface-hidden will-change-[opacity]",
            layer.id === activeLayerId ? "opacity-90 starting:opacity-0" : "opacity-0",
          )}
        />
      ))}
    </div>
  );
}

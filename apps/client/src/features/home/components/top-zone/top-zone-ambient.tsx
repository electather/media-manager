import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

const FADE_DELAY_MS = 20;
const FADE_OUT_MS = 900;

type Layer = { id: number; src: string; visible: boolean };

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
      className="pointer-events-none absolute inset-x-0 -top-32 -bottom-80"
    >
      {layers.map((layer) => (
        <img
          key={layer.id}
          src={layer.src}
          alt=""
          className={cn(
            "absolute inset-0 size-full transform-gpu object-cover blur-[110px] saturate-[1.9] transition-opacity duration-700 ease-out [backface-visibility:hidden] will-change-[opacity]",
            layer.visible ? "opacity-90" : "opacity-0",
          )}
        />
      ))}
    </div>
  );
}

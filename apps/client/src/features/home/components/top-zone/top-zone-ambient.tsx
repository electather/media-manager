import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

const FADE_DELAY_MS = 20;
const FADE_OUT_MS = 900;

type Layer = { id: number; src: string; visible: boolean };

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
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="top-zone-ambient"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
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
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/10" />
    </div>
  );
}

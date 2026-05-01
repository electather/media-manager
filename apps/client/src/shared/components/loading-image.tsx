import { useState, type SyntheticEvent } from "react";
import { extractGlowColor } from "@/shared/lib/image-glow";
import { cn } from "@/shared/lib/utils";

type LoadingImageProps = {
  src: string;
  alt: string;
  className?: string;
  onColor?: (color: string) => void;
};

export function LoadingImage({ src, alt, className, onColor }: LoadingImageProps) {
  const [loaded, setLoaded] = useState(false);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    setLoaded(true);
    if (!onColor) return;
    extractGlowColor(event.currentTarget)
      .then((color) => {
        if (color) onColor(color);
      })
      .catch(() => {});
  };

  return (
    <>
      {!loaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 animate-pulse rounded-[inherit] bg-muted"
        />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        crossOrigin={onColor ? "anonymous" : undefined}
        onLoad={handleLoad}
        onError={() => setLoaded(true)}
        className={cn(
          "transition-opacity duration-300 ease-out",
          loaded ? "opacity-100" : "opacity-0",
          className,
        )}
      />
    </>
  );
}

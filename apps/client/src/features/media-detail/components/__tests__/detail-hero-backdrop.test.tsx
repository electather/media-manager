// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { DetailHeroBackdrop } from "../detail-hero-backdrop";

afterEach(() => {
  cleanup();
});

/** The backdrop img has alt="" (decorative), giving it the "presentation" role.
 * Query it directly via the container instead of by ARIA role. */
function getImg(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector("img");
}

describe("DetailHeroBackdrop", () => {
  it("renders the img element when a src is provided", () => {
    const { container } = render(<DetailHeroBackdrop src="https://example.com/backdrop.jpg" />);
    expect(getImg(container)).toBeTruthy();
  });

  it("falls back to posterSrc when src is undefined", () => {
    const { container } = render(
      <DetailHeroBackdrop src={undefined} posterSrc="https://example.com/poster.jpg" />,
    );
    const img = getImg(container) as HTMLImageElement;
    expect(img.src).toBe("https://example.com/poster.jpg");
  });

  it("renders no img when neither src nor posterSrc is provided", () => {
    const { container } = render(<DetailHeroBackdrop src={undefined} />);
    expect(getImg(container)).toBeNull();
  });

  it("hides the img after an onError event — broken images must not show a torn placeholder", () => {
    const { container } = render(<DetailHeroBackdrop src="https://example.com/backdrop.jpg" />);
    const img = getImg(container)!;
    fireEvent.error(img);
    // After the error the component must remove the img element so no broken
    // image indicator is shown to the user.
    expect(getImg(container)).toBeNull();
  });

  it("shows the gradient overlays even when the image has failed", () => {
    const { container } = render(<DetailHeroBackdrop src="https://example.com/backdrop.jpg" />);
    const img = getImg(container)!;
    fireEvent.error(img);
    // The two overlay divs (top-down dim + radial pool) must stay present to
    // keep the hero legible regardless of image load state.
    // Query by className since happy-dom does not retain inline style in the
    // attribute selector after a state update.
    const overlays = container.querySelectorAll<HTMLElement>(".absolute.inset-0");
    expect(overlays.length).toBe(2);
  });

  it("resets the error state when imageSrc changes — new valid images must not remain hidden", () => {
    // This encodes the invariant described in detail-hero-backdrop.tsx:23-25:
    // the failed flag must be cleared whenever the resolved imageSrc changes so
    // that navigating between two items whose backdrops both errored will still
    // attempt to load the second image.
    const { container, rerender } = render(
      <DetailHeroBackdrop src="https://example.com/first.jpg" />,
    );

    // Trigger a load error for the first image.
    fireEvent.error(getImg(container)!);
    expect(getImg(container)).toBeNull();

    // Navigate to a second item — the component stays mounted but src changes.
    rerender(<DetailHeroBackdrop src="https://example.com/second.jpg" />);

    // The img must be visible again so the browser can attempt to load the new src.
    const secondImg = getImg(container) as HTMLImageElement;
    expect(secondImg).toBeTruthy();
    expect(secondImg.src).toBe("https://example.com/second.jpg");
  });

  it("resets the error state when imageSrc changes via posterSrc fallback", () => {
    // Mirrors the reset invariant for the posterSrc code path: when a broken
    // poster is replaced by a new poster (src remains undefined), the reset
    // must still fire because imageSrc itself changed.
    const { container, rerender } = render(
      <DetailHeroBackdrop src={undefined} posterSrc="https://example.com/poster-a.jpg" />,
    );
    fireEvent.error(getImg(container)!);
    expect(getImg(container)).toBeNull();

    rerender(<DetailHeroBackdrop src={undefined} posterSrc="https://example.com/poster-b.jpg" />);
    const secondImg = getImg(container) as HTMLImageElement;
    expect(secondImg).toBeTruthy();
    expect(secondImg.src).toBe("https://example.com/poster-b.jpg");
  });
});

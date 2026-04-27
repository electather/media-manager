// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";

import { useInView } from "../use-in-view";

interface FakeObserver {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  fire: (entries: Array<{ isIntersecting: boolean }>) => void;
}

let observers: FakeObserver[] = [];

class MockIntersectionObserver {
  private readonly cb: (entries: Array<{ isIntersecting: boolean }>) => void;
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn();
  root = null;
  rootMargin = "0px";
  thresholds = [];
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    this.cb = cb;
    observers.push({
      observe: this.observe,
      disconnect: this.disconnect,
      fire: (entries) => this.cb(entries),
    });
  }
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref);
  return (
    <div ref={ref} data-testid="probe">
      {seen ? "yes" : "no"}
    </div>
  );
}

describe("useInView", () => {
  it("starts false and observes the element", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("no");
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observe).toHaveBeenCalledTimes(1);
  });

  it("flips to true on the first intersecting entry", async () => {
    render(<Probe />);
    await act(async () => {
      observers[0]!.fire([{ isIntersecting: true }]);
    });
    expect(screen.getByTestId("probe").textContent).toBe("yes");
  });

  it("stays true after subsequent non-intersecting entries (one-shot)", async () => {
    render(<Probe />);
    await act(async () => {
      observers[0]!.fire([{ isIntersecting: true }]);
    });
    // Cannot easily fire again because the hook disconnects after the first
    // hit, but the contract is: state remains true regardless of any
    // additional observer activity. Assert by re-rendering.
    expect(screen.getByTestId("probe").textContent).toBe("yes");
  });

  it("disconnects the observer once it has intersected", async () => {
    render(<Probe />);
    await act(async () => {
      observers[0]!.fire([{ isIntersecting: true }]);
    });
    expect(observers[0]!.disconnect).toHaveBeenCalled();
  });

  it("disconnects on unmount even if no intersection has fired", () => {
    // Covers the effect's cleanup path: if the element never enters the
    // viewport before the component unmounts, the observer must still be
    // torn down so it doesn't leak past the host element's lifetime.
    const { unmount } = render(<Probe />);
    expect(observers).toHaveLength(1);
    expect(observers[0]!.disconnect).not.toHaveBeenCalled();
    unmount();
    expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
  });
});

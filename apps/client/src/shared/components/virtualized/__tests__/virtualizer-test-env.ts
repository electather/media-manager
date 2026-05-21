import { vi } from "vite-plus/test";

interface SetupVirtualizerEnvOptions {
  /** Viewport inner width in pixels. Default 1024. */
  width?: number;
  /** Viewport inner height in pixels. Default 800. */
  height?: number;
  /**
   * Bounding-rect width returned for any measured element. Defaults to
   * `width` so window-virtualized grids see a non-zero container.
   */
  elementWidth?: number;
  /** Bounding-rect height per measured element. Default 120. */
  elementHeight?: number;
}

interface ObserverCallbackEntry {
  cb: ResizeObserverCallback;
  targets: Set<Element>;
}

/**
 * jsdom / happy-dom report zero for layout sizes, which makes
 * `@tanstack/react-virtual` render zero virtual items. This helper mocks the
 * minimum DOM surface the virtualizers read so a test can assert mounted
 * counts. Returns a `triggerResize(width, height?)` callback that fires the
 * observed `ResizeObserver` callbacks with the new dimensions.
 */
export function setupVirtualizerEnv({
  width = 1024,
  height = 800,
  elementWidth,
  elementHeight = 120,
}: SetupVirtualizerEnvOptions = {}) {
  const state = {
    width,
    height,
    elementWidth: elementWidth ?? width,
    elementHeight,
  };

  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    get: () => state.width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    get: () => state.height,
  });

  const callbacks = new Set<ObserverCallbackEntry>();

  class MockResizeObserver implements ResizeObserver {
    private entry: ObserverCallbackEntry;
    constructor(cb: ResizeObserverCallback) {
      this.entry = { cb, targets: new Set() };
      callbacks.add(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.add(target);
      // Fire once on first observe so consumers can compute initial state.
      this.entry.cb([makeEntry(target, state)] as unknown as ResizeObserverEntry[], this);
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target);
    }
    disconnect() {
      this.entry.targets.clear();
      callbacks.delete(this.entry);
    }
  }
  vi.stubGlobal("ResizeObserver", MockResizeObserver);

  const originalGetRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: void) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: state.elementHeight,
      right: state.elementWidth,
      width: state.elementWidth,
      height: state.elementHeight,
      toJSON: () => ({}),
    } as DOMRect;
  };

  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return state.elementWidth;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return state.elementHeight;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return state.elementWidth;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return state.elementHeight;
    },
  });

  function triggerResize(nextWidth: number, nextHeight?: number) {
    state.width = nextWidth;
    state.elementWidth = nextWidth;
    if (nextHeight !== undefined) {
      state.height = nextHeight;
      state.elementHeight = nextHeight;
    }
    for (const entry of callbacks) {
      for (const target of entry.targets) {
        entry.cb(
          [makeEntry(target, state)] as unknown as ResizeObserverEntry[],
          {} as ResizeObserver,
        );
      }
    }
  }

  function cleanup() {
    callbacks.clear();
    Element.prototype.getBoundingClientRect = originalGetRect;
    if (originalClientWidth)
      Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    if (originalClientHeight)
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    if (originalOffsetWidth)
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
    if (originalOffsetHeight)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    if (originalInnerWidth) Object.defineProperty(window, "innerWidth", originalInnerWidth);
    if (originalInnerHeight) Object.defineProperty(window, "innerHeight", originalInnerHeight);
    vi.unstubAllGlobals();
  }

  return { triggerResize, cleanup };
}

function makeEntry(target: Element, state: { elementWidth: number; elementHeight: number }) {
  const box = { blockSize: state.elementHeight, inlineSize: state.elementWidth };
  return {
    target,
    contentRect: {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: state.elementHeight,
      right: state.elementWidth,
      width: state.elementWidth,
      height: state.elementHeight,
      toJSON: () => ({}),
    },
    borderBoxSize: [box],
    contentBoxSize: [box],
    devicePixelContentBoxSize: [box],
  };
}

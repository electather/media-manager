// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { NotificationItemDto } from "../../shared/types";

const sonnerCustomMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    custom: (...args: unknown[]) => sonnerCustomMock(...args),
    dismiss: vi.fn(),
  },
}));

// Paraglide messages stub — return a stable string for each key.
vi.mock("@/paraglide/messages", () => ({
  m: {
    notifications_toast_dismiss_aria: () => "Dismiss",
    notifications_toast_cluster_title: ({ count }: { count: number }) =>
      `+${count} more new notifications`,
  },
}));

// SeverityIcon is a presentational component; stub it to avoid icon rendering complexity.
vi.mock("../../shared/severity-icon", () => ({
  SeverityIcon: () => null,
}));

// Button is used for dismiss; keep a real element so click events work.
vi.mock("@/shared/ui/button", () => ({
  Button: ({ children, onClick, "aria-label": ariaLabel }: React.ComponentProps<"button">) => (
    <button aria-label={ariaLabel} onClick={onClick}>
      {children}
    </button>
  ),
}));

// cn is a string utility; return the joined class names.
vi.mock("@/shared/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

import { NotificationToastCard, renderToast, renderClusterToast } from "../toast-renderer";
import type { ToastDeps } from "../toast-renderer";

function makeItem(
  id: string,
  severity: NotificationItemDto["severity"] = "warn",
  actionUrl?: string,
): NotificationItemDto {
  return {
    id,
    title: `Title ${id}`,
    body: "Body text",
    severity,
    category: "media",
    createdAt: Date.now(),
    readAt: null,
    ...(actionUrl ? { actionUrl } : {}),
  } as NotificationItemDto;
}

function makeDeps(): ToastDeps & {
  navigate: ReturnType<typeof vi.fn>;
  markRead: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
} {
  const navigate = vi.fn();
  const markRead = vi.fn();
  const publish = vi.fn();
  return {
    navigate,
    markReadMutation: { mutate: markRead } as unknown as ToastDeps["markReadMutation"],
    broadcast: { has: () => false, publish },
    markRead,
    publish,
  };
}

beforeEach(() => {
  sonnerCustomMock.mockReset();
});

afterEach(() => cleanup());

describe("NotificationToastCard", () => {
  it("click on card body calls onClick and not onDismiss", () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const item = makeItem("x");
    const { getByRole } = render(
      <NotificationToastCard item={item} onClick={onClick} onDismiss={onDismiss} />,
    );

    fireEvent.click(getByRole("button", { name: /title x/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("click on dismiss button calls onDismiss and not onClick", () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const item = makeItem("x");
    const { getByRole } = render(
      <NotificationToastCard item={item} onClick={onClick} onDismiss={onDismiss} />,
    );

    // The dismiss button is the one with "Dismiss" aria-label.
    fireEvent.click(getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("truncates body longer than 140 characters", () => {
    const longBody = "a".repeat(150);
    const item = { ...makeItem("x"), body: longBody };
    const { getByText } = render(
      <NotificationToastCard item={item} onClick={vi.fn()} onDismiss={vi.fn()} />,
    );
    const rendered = getByText(/^a+…$/);
    expect(rendered.textContent!.length).toBe(141); // 140 chars + ellipsis
  });
});

describe("renderToast", () => {
  it("uses duration=Infinity for error severity", () => {
    const deps = makeDeps();
    renderToast(makeItem("e", "error"), deps);
    expect(sonnerCustomMock).toHaveBeenCalledTimes(1);
    const opts = sonnerCustomMock.mock.calls[0]![1] as { duration: number };
    expect(opts.duration).toBe(Infinity);
  });

  it("uses duration=5000 for warn severity", () => {
    const deps = makeDeps();
    renderToast(makeItem("w", "warn"), deps);
    const opts = sonnerCustomMock.mock.calls[0]![1] as { duration: number };
    expect(opts.duration).toBe(5_000);
  });

  it("publishes to broadcast after calling sonner.custom", () => {
    const deps = makeDeps();
    renderToast(makeItem("p"), deps);
    expect(deps.publish).toHaveBeenCalledWith("p");
  });

  it("toast id is prefixed with notif:", () => {
    const deps = makeDeps();
    renderToast(makeItem("abc"), deps);
    const opts = sonnerCustomMock.mock.calls[0]![1] as { id: string };
    expect(opts.id).toBe("notif:abc");
  });
});

describe("renderClusterToast", () => {
  it("calls sonner.custom with duration=5000", () => {
    const deps = makeDeps();
    renderClusterToast(3, deps);
    const opts = sonnerCustomMock.mock.calls[0]![1] as { duration: number };
    expect(opts.duration).toBe(5_000);
  });
});

// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { HeaderDialog } from "../detail/security/header-dialog";

const mutate = vi.fn();
const reset = vi.fn();
vi.mock("../detail/use-admin-headers", () => ({
  useUpsertAdminHeader: () => ({ mutate, reset, isPending: false }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Find the password/value input — the dialog uses type="password" for the value field. */
function getValueInput() {
  return document.querySelector<HTMLInputElement>('input[type="password"]')!;
}

function renderAdd() {
  const onClose = vi.fn();
  render(<HeaderDialog pluginId="tmdb" state={{ kind: "add" }} onClose={onClose} />);
  return { onClose };
}

function renderEdit(name = "X-Corp-Key") {
  const onClose = vi.fn();
  render(<HeaderDialog pluginId="tmdb" state={{ kind: "edit", name }} onClose={onClose} />);
  return { onClose };
}

describe("HeaderDialog — add mode validation", () => {
  it("shows empty-value error when value is whitespace-only", async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByPlaceholderText("X-Corp-Key"), "Valid-Header");
    await user.type(getValueInput(), "   ");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(screen.getByText(/value cannot be empty/i)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows reserved-name error when a reserved header name is used", async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByPlaceholderText("X-Corp-Key"), "host");
    await user.type(getValueInput(), "example.com");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(screen.getByText(/header is reserved by the runtime/i)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows invalid-name error when name is whitespace-only", async () => {
    // "   ".trim() === "" → HEADER_NAME_PATTERN.test("") returns false → error must show.
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByPlaceholderText("X-Corp-Key"), "   ");
    await user.type(getValueInput(), "some-value");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(screen.getByText(/invalid header name/i)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows invalid-name error for names that fail the RFC 7230 pattern", async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByPlaceholderText("X-Corp-Key"), "Invalid Header");
    await user.type(getValueInput(), "some-value");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(screen.getByText(/invalid header name/i)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace from name before submitting", async () => {
    // The save handler calls name.trim() before passing to mutate. If trimmedName
    // were not used, the mutation would receive " X-Corp-Key " and this would fail.
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByPlaceholderText("X-Corp-Key"), " X-Corp-Key ");
    await user.type(getValueInput(), "secret");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(mutate).toHaveBeenCalledWith(
      { name: "X-Corp-Key", value: "secret" },
      expect.any(Object),
    );
  });

  it("submits with the raw value preserving leading/trailing whitespace", async () => {
    // Secrets are opaque; leading/trailing whitespace must NOT be stripped.
    // If trimmedValue were passed instead of the raw value this assertion would fail.
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByPlaceholderText("X-Corp-Key"), "X-Corp-Key");
    // Type a value with a trailing space — the input element captures each keystroke.
    await user.type(getValueInput(), "secret-token ");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(mutate).toHaveBeenCalledWith(
      { name: "X-Corp-Key", value: "secret-token " },
      expect.any(Object),
    );
  });
});

describe("HeaderDialog — edit mode validation", () => {
  it("skips reserved-name check in edit mode and submits successfully", async () => {
    // Edit mode: name field is read-only; reserved-name gate must not fire again.
    const user = userEvent.setup();
    renderEdit("host");

    // Uncheck preserve-value to expose the value field.
    await user.click(screen.getByRole("checkbox"));

    await user.type(getValueInput(), "example.com");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(screen.queryByText(/header is reserved by the runtime/i)).toBeNull();
    expect(mutate).toHaveBeenCalledWith({ name: "host", value: "example.com" }, expect.any(Object));
  });

  it("closes without calling mutate when preserveValue is checked", async () => {
    // Default state in edit mode: preserve-value is checked, so save just closes.
    const user = userEvent.setup();
    const { onClose } = renderEdit("X-Corp-Key");

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

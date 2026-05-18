import { describe, it, expect, vi } from "vite-plus/test";
import { createEmailChangeHooks } from "../internal/email-change-hooks";

const ctxFor = (userId: string) => ({
  context: { session: { user: { id: userId } } },
});

describe("createEmailChangeHooks", () => {
  it("emails the OLD address when the new email differs", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const hooks = createEmailChangeHooks({
      readUserEmail: async () => "old@example.com",
      sendEmail,
    });

    await hooks.before({ email: "new@example.com" }, ctxFor("user-1"));
    await hooks.after({ id: "user-1", email: "new@example.com" });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0]?.[0];
    expect(message?.to).toBe("old@example.com");
    expect(message?.subject).toMatch(/email/i);
    expect(message?.text).toContain("new@example.com");
  });

  it("does NOT email when the email is unchanged", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const hooks = createEmailChangeHooks({
      readUserEmail: async () => "same@example.com",
      sendEmail,
    });

    await hooks.before({ name: "Alice" }, ctxFor("user-1"));
    await hooks.after({ id: "user-1", email: "same@example.com" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does NOT email when no previous email was captured (no session id)", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const readUserEmail = vi.fn();
    const hooks = createEmailChangeHooks({ readUserEmail, sendEmail });

    // Null ctx (e.g. admin-driven update outside an authenticated session)
    // ⇒ before is a no-op; after has nothing in the pending map.
    await hooks.before({ email: "new@example.com" }, null);
    await hooks.after({ id: "user-1", email: "new@example.com" });

    expect(readUserEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("clears the pending entry so a follow-up update does not double-notify", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    let currentEmail = "old@example.com";
    const hooks = createEmailChangeHooks({
      readUserEmail: async () => currentEmail,
      sendEmail,
    });

    // First update: old → new. Notification expected.
    await hooks.before({ email: "new@example.com" }, ctxFor("user-1"));
    await hooks.after({ id: "user-1", email: "new@example.com" });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // A second after-only call (simulating a subsequent unrelated user.update
    // that did not capture anything) must not resend the prior notification.
    currentEmail = "new@example.com";
    await hooks.after({ id: "user-1", email: "new@example.com" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("swallows DB read errors so the user update is not blocked", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const warn = vi.fn();
    const hooks = createEmailChangeHooks({
      readUserEmail: async () => {
        throw new Error("db down");
      },
      sendEmail,
      logger: { warn },
    });

    // The before hook must NOT throw — the user update needs to proceed
    // even if the side-effect capture fails.
    await expect(
      hooks.before({ email: "new@example.com" }, ctxFor("user-1")),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);

    // No previous email captured ⇒ no notification.
    await hooks.after({ id: "user-1", email: "new@example.com" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("isolates pending state per user id", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const emails: Record<string, string> = {
      "user-a": "a-old@example.com",
      "user-b": "b-old@example.com",
    };
    const hooks = createEmailChangeHooks({
      readUserEmail: async (id) => emails[id] ?? null,
      sendEmail,
    });

    await hooks.before({ email: "a-new@example.com" }, ctxFor("user-a"));
    await hooks.before({ email: "b-new@example.com" }, ctxFor("user-b"));

    // user-b's after-hook must read user-b's captured email, not user-a's.
    await hooks.after({ id: "user-b", email: "b-new@example.com" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]?.to).toBe("b-old@example.com");

    await hooks.after({ id: "user-a", email: "a-new@example.com" });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls[1]?.[0]?.to).toBe("a-old@example.com");
  });
});

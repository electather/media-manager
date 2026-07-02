import { describe, it, expect, vi } from "vite-plus/test";
import { NAME_MAX_LENGTH } from "@nama/shared/users";
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

  it("swallows sendEmail errors so the user update is not blocked", async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error("smtp down"));
    const warn = vi.fn();
    const hooks = createEmailChangeHooks({
      readUserEmail: async () => "old@example.com",
      sendEmail,
      logger: { warn },
    });

    await hooks.before({ email: "new@example.com" }, ctxFor("user-1"));
    // The after hook must NOT throw — provider failure is a side effect, not
    // a reason to surface a 500 on the underlying user update.
    await expect(hooks.after({ id: "user-1", email: "new@example.com" })).resolves.toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
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

// #815 only guarded the create path; Better Auth re-syncs `name` on every later
// social login via the update hook. #831 caps it in that hook's `before` without
// breaking email-change capture, whose run must not depend on truncation.
describe("createEmailChangeHooks name-length guard (update path)", () => {
  const noopDeps = () => ({
    readUserEmail: vi.fn().mockResolvedValue(null),
    sendEmail: vi.fn().mockResolvedValue(undefined),
  });

  it("truncates a re-synced provider name over NAME_MAX_LENGTH", async () => {
    const hooks = createEmailChangeHooks(noopDeps());
    const longName = "a".repeat(NAME_MAX_LENGTH + 25);

    const result = await hooks.before({ name: longName }, ctxFor("user-1"));

    expect(result?.data?.name).toBe("a".repeat(NAME_MAX_LENGTH));
  });

  it("leaves a name at or below NAME_MAX_LENGTH untouched (returns void)", async () => {
    const hooks = createEmailChangeHooks(noopDeps());

    const result = await hooks.before({ name: "a".repeat(NAME_MAX_LENGTH) }, ctxFor("user-1"));

    expect(result).toBeUndefined();
  });

  it("returns void for an update payload that carries no name field", async () => {
    const hooks = createEmailChangeHooks(noopDeps());

    // Email-only update (no `name` key): the guard must not fabricate a clone,
    // else Better Auth would rewrite the row on every such update.
    const result = await hooks.before({ email: "new@x.com" }, ctxFor("user-1"));

    expect(result).toBeUndefined();
  });

  it("still captures the previous email even when it also truncates the name", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const hooks = createEmailChangeHooks({
      readUserEmail: async () => "old@example.com",
      sendEmail,
    });

    // A single update carrying both a new email and an over-long name: the
    // email-change notification must still fire, proving the DB capture is not
    // short-circuited by the truncation return.
    await hooks.before(
      { email: "new@example.com", name: "x".repeat(NAME_MAX_LENGTH + 1) },
      ctxFor("user-1"),
    );
    await hooks.after({ id: "user-1", email: "new@example.com" });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]?.to).toBe("old@example.com");
  });

  it("truncates the name even when ctx is null (email capture is skipped)", async () => {
    const hooks = createEmailChangeHooks(noopDeps());
    const longName = "z".repeat(NAME_MAX_LENGTH + 5);

    // Null ctx means the email capture is skipped, but the pure name guard must
    // still cap the payload so an admin/system update cannot write an over-long
    // name to the validated column.
    const result = await hooks.before({ name: longName }, null);

    expect(result?.data?.name).toBe("z".repeat(NAME_MAX_LENGTH));
  });

  it("returns void (no clone) for a within-limit name while still capturing the email", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const hooks = createEmailChangeHooks({
      readUserEmail: async () => "old@example.com",
      sendEmail,
    });

    // Within-limit name + email change: the return must stay undefined (Better
    // Auth skips the clone) yet the capture/notification path must still fire.
    const result = await hooks.before(
      { email: "new@example.com", name: "a".repeat(NAME_MAX_LENGTH) },
      ctxFor("user-1"),
    );
    await hooks.after({ id: "user-1", email: "new@example.com" });

    expect(result).toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

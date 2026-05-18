import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";

vi.mock("../../env", () => ({
  env: { EMAIL_PROVIDER_CONFIGURED: false },
}));

import { env } from "../../env";
import { sendEmail, isEmailEnabled } from "../internal/email";

const mutableEnv = env as { EMAIL_PROVIDER_CONFIGURED: boolean };

beforeEach(() => {
  mutableEnv.EMAIL_PROVIDER_CONFIGURED = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendEmail", () => {
  it("no-ops when EMAIL_PROVIDER_CONFIGURED is false", async () => {
    mutableEnv.EMAIL_PROVIDER_CONFIGURED = false;
    const spy = vi.spyOn(consola, "info").mockImplementation(() => undefined);

    await sendEmail({ to: "old@example.com", subject: "x", text: "y" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("logs (would-send) when EMAIL_PROVIDER_CONFIGURED is true", async () => {
    mutableEnv.EMAIL_PROVIDER_CONFIGURED = true;
    const spy = vi.spyOn(consola, "info").mockImplementation(() => undefined);

    await sendEmail({ to: "old@example.com", subject: "Hello", text: "Body" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain("old@example.com");
    expect(spy.mock.calls[0]?.[0]).toContain("Hello");
  });
});

describe("isEmailEnabled", () => {
  it("reflects the env flag", () => {
    mutableEnv.EMAIL_PROVIDER_CONFIGURED = false;
    expect(isEmailEnabled()).toBe(false);
    mutableEnv.EMAIL_PROVIDER_CONFIGURED = true;
    expect(isEmailEnabled()).toBe(true);
  });
});

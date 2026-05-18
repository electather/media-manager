import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { EMAIL_PROVIDER_CONFIGURED: false },
}));

import { env } from "../../env";
import { sendEmail, isEmailEnabled } from "../internal/email";

const mutableEnv = env as { EMAIL_PROVIDER_CONFIGURED: boolean };

beforeEach(() => {
  mutableEnv.EMAIL_PROVIDER_CONFIGURED = false;
});

describe("sendEmail", () => {
  it("no-ops when EMAIL_PROVIDER_CONFIGURED is false", async () => {
    mutableEnv.EMAIL_PROVIDER_CONFIGURED = false;
    await expect(
      sendEmail({ to: "old@example.com", subject: "x", text: "y" }),
    ).resolves.toBeUndefined();
  });

  it("throws when EMAIL_PROVIDER_CONFIGURED is true (no real provider wired)", async () => {
    mutableEnv.EMAIL_PROVIDER_CONFIGURED = true;
    await expect(
      sendEmail({ to: "old@example.com", subject: "Hello", text: "Body" }),
    ).rejects.toThrow("EMAIL_PROVIDER_CONFIGURED=true");
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

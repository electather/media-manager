import { authClient } from "@/shared/lib/auth";
import type { AuthSession } from "./types";

export async function fetchSessions(): Promise<AuthSession[]> {
  const result = await authClient.listSessions();
  if (result.error) throw new Error(result.error.message ?? "Failed to load sessions");
  return (result.data ?? []) as AuthSession[];
}

export async function fetchRevokeSession(token: string): Promise<void> {
  const result = await authClient.revokeSession({ token });
  if (result.error) throw new Error(result.error.message ?? "Revoke failed");
}

export async function fetchRevokeOtherSessions(): Promise<void> {
  const result = await authClient.revokeOtherSessions();
  if (result.error) throw new Error(result.error.message ?? "Revoke failed");
}

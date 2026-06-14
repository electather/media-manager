import { z } from "zod";

/**
 * The single source of truth for new-password policy across client and server.
 *
 * The minimum of 12 and maximum of 256 follow NIST SP 800-63B guidance: favour
 * length over composition rules, accept long passphrases, and cap the input so
 * an over-long value cannot become a hashing denial-of-service vector. Any flow
 * that sets or changes a password (bootstrap claim, admin user creation) must
 * reuse this schema so the rule never drifts between call sites.
 *
 * Verifying an EXISTING credential is intentionally NOT gated by this schema —
 * legacy accounts may hold shorter passwords, so the verification path stays
 * lenient (see `deleteAccountSchema.currentPassword`).
 *
 * Deferred follow-up: screening new passwords against a known-breach list via
 * HIBP k-anonymity is a service-layer concern tracked separately (optional in
 * the issue) and deliberately not enforced here.
 */
export const passwordSchema = z.string().min(12).max(256);

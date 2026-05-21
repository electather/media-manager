// fallow-ignore-next-line boundary-violation
import type { Db } from "../../__tests__/helpers/in-memory-db";
// Test helper seeds auth tables directly to set up integration fixtures.
// fallow-ignore-next-line boundary-violation
import { user } from "../../db/schema/auth";

export async function seedUser(db: Db, userId: string): Promise<void> {
  await db.insert(user).values({
    id: userId,
    name: userId,
    email: `${userId}@test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

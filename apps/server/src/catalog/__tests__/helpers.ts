// fallow-ignore-next-line boundary-violation
import type { Db } from "../../__tests__/helpers/in-memory-db";
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

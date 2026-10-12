import { cookies } from "next/headers";
import { getDb } from "./db";
import { SESSION_COOKIE, userFromToken, type User } from "./session";
import { touchSchedule } from "./works";

export async function getCurrentUser(): Promise<User | null> {
  const db = getDb();
  touchSchedule(db);
  const jar = await cookies();
  return userFromToken(db, jar.get(SESSION_COOKIE)?.value);
}

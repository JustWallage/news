import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { preferences } from "../../db/schema";
import { preferencesUpdateSchema } from "../../shared/api";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";

export const preferencesRoutes = new Hono<AppEnv>();

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

preferencesRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userEmail, c.get("userEmail")))
    .limit(1);
  const row = rows[0] ?? null;
  return c.json({
    text: row?.text ?? "",
    updatedAt: row === null ? null : row.updatedAt.toISOString(),
  });
});

preferencesRoutes.put("/", async (c) => {
  const parsed = preferencesUpdateSchema.safeParse(
    await parseJsonBody(c.req.raw),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const db = getDb(c.env);
  const userEmail = c.get("userEmail");
  const { text } = parsed.data;
  const rows = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userEmail, userEmail))
    .limit(1);
  const existing = rows[0] ?? null;
  // Re-saving identical text is a no-op: it must not bump the version (that would
  // force a needless full re-evaluation on the next digest).
  if (existing !== null && existing.text === text) {
    return c.json({ ok: true });
  }
  if (existing === null) {
    await db
      .insert(preferences)
      .values({ userEmail, text, updatedAt: new Date() });
  } else {
    await db
      .update(preferences)
      .set({ text, version: existing.version + 1, updatedAt: new Date() })
      .where(eq(preferences.userEmail, userEmail));
  }
  return c.json({ ok: true });
});

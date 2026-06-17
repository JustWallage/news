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
  await db
    .insert(preferences)
    .values({ userEmail, text: parsed.data.text, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: preferences.userEmail,
      set: { text: parsed.data.text, updatedAt: new Date() },
    });
  return c.json({ ok: true });
});

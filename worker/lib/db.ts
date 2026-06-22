import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";

export const getDb = (env: { DB: D1Database }) => drizzle(env.DB, { schema });

export type Db = ReturnType<typeof getDb>;

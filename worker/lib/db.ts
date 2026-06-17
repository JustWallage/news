import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import type { Bindings } from "../env";

export const getDb = (env: Bindings) => drizzle(env.DB, { schema });

export type Db = ReturnType<typeof getDb>;

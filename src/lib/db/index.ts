import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
const globalDb = globalThis as unknown as { erutyPool?: Pool };
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. Configure .env before starting the server or DB commands.");
export const pool = globalDb.erutyPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
if (process.env.NODE_ENV !== "production") globalDb.erutyPool = pool;
export const db = drizzle(pool, { schema });

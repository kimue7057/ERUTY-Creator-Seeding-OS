import "dotenv/config";
import { migratePreservingHistory } from "../src/lib/db/migrate";
import { db, pool } from "../src/lib/db";
try { await migratePreservingHistory(db); console.log("Migrations applied; existing history preserved."); }
finally { await pool.end(); }

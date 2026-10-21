import "dotenv/config";
import { cleanupUploads } from "../src/lib/assets/cleanup";
import { createS3Storage } from "../src/lib/storage/s3";
import { pool } from "../src/lib/db";
try { console.log(await cleanupUploads(createS3Storage())); }
finally { await pool.end(); }

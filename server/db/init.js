require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pool = require("./pool");

/**
 * Applies schema.sql to the database named in DATABASE_URL.
 *
 * Every statement in the file is idempotent (CREATE ... IF NOT EXISTS), so
 * running this on every deploy or restart is safe: it creates whatever is
 * missing and leaves existing data alone. It's what `npm run db:init` runs,
 * and what the production start command runs before the server boots — so a
 * brand-new hosted database needs no manual `psql` step.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  // With no parameters, node-postgres uses the simple query protocol, which
  // accepts a whole file of statements in a single call.
  await pool.query(sql);
  console.log("Database schema is ready.");
}

main()
  .catch((err) => {
    console.error("Could not set up the database:", err.message);
    process.exitCode = 1; // non-zero exit stops `npm run db:init && npm start` before the server boots
  })
  .finally(() => pool.end());

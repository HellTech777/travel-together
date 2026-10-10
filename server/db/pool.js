const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // A hosted database reached over the public internet only accepts SSL
  // connections. If its URL doesn't already carry ?sslmode=require, set
  // DATABASE_SSL=true. A local database, or a provider's internal/private URL
  // (Render's Internal Database URL), needs nothing.
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle database client", err);
});

module.exports = pool;

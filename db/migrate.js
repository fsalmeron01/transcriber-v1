#!/usr/bin/env node
"use strict";

const { Pool } = require("/app/node_modules/pg");
const fs = require("fs");
const path = require("path");

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      retries--;
      if (retries === 0) {
        console.error("[migrate] Could not connect to Postgres after 10 attempts. Exiting.");
        process.exit(1);
      }
      console.log(`[migrate] Postgres not ready, retrying... (${retries} left)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const sql = fs.readFileSync(path.join(__dirname, "init.sql"), "utf8");

  try {
    await pool.query(sql);
    console.log("[migrate] Database schema is up to date.");
  } catch (err) {
    console.error("[migrate] Migration failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

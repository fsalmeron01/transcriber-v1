#!/usr/bin/env node
"use strict";

const { Pool } = require("/app/node_modules/pg");
const fs = require("fs");
const path = require("path");

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  let retries = 10;
  while (retries > 0) {
    try { await pool.query("SELECT 1"); break; }
    catch {
      retries--;
      if (retries === 0) { console.error("[migrate] Postgres never ready."); process.exit(1); }
      console.log(`[migrate] Postgres not ready, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Run base schema
  const sql = fs.readFileSync(path.join(__dirname, "init.sql"), "utf8");
  try {
    await pool.query(sql);
    console.log("[migrate] Base schema applied.");
  } catch (err) {
    console.error("[migrate] Base schema error:", err.message);
    process.exit(1);
  }

  // Add new columns to summaries if they don't exist (safe ALTER TABLE)
  const newCols = [
    ["mode",              "TEXT"],
    ["mode_emoji",        "TEXT"],
    ["newspack_excerpt",  "TEXT"],
    ["categories_json",   "JSONB NOT NULL DEFAULT '[]'::jsonb"],
    ["tags_json",         "JSONB NOT NULL DEFAULT '[]'::jsonb"],
    ["yoast_json",        "JSONB NOT NULL DEFAULT '{}'::jsonb"],
    ["headline_heat_score", "INTEGER"],
    ["headline_heat_label", "TEXT"],
    ["seo_strength_score",  "INTEGER"],
    ["legal_risk_level",    "TEXT"],
    ["legal_flags_json",    "JSONB NOT NULL DEFAULT '[]'::jsonb"],
    ["readability_json",    "JSONB NOT NULL DEFAULT '{}'::jsonb"],
    ["photo_guidance",      "TEXT"],
  ];

  for (const [col, type] of newCols) {
    try {
      await pool.query(`ALTER TABLE summaries ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    } catch (err) {
      console.log(`[migrate] Column ${col}: ${err.message}`);
    }
  }

  console.log("[migrate] Schema is up to date.");
  await pool.end();
}

migrate();

"use strict";

const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const POLL_INTERVAL = 15000;

async function getPendingJob() {
  const result = await pool.query(`
    SELECT j.id, t.clean_text, t.segments_json, t.language
    FROM jobs j
    JOIN transcripts t ON t.job_id = j.id
    LEFT JOIN summaries s ON s.job_id = j.id
    WHERE j.status = 'completed'
      AND t.clean_text IS NOT NULL
      AND t.clean_text != ''
      AND s.id IS NULL
    ORDER BY j.updated_at ASC
    LIMIT 1
  `);
  return result.rows[0] || null;
}

async function callClaude(transcript) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `You are a professional journalist and editor. Analyze this transcript and return a JSON object with exactly these fields:
- headline: a compelling news headline (max 12 words)
- subtitle: a supporting subheadline (max 20 words)
- summary: a 2-3 paragraph summary of the content
- key_quotes: array of 3-5 most important direct quotes from the transcript (exact words)
- article_draft: a full news article draft (4-6 paragraphs, professional journalistic style, AP style)
- seo_description: 1-2 sentence SEO meta description under 160 characters

Return ONLY valid JSON. No markdown, no code fences, no other text.

TRANSCRIPT:
${transcript.substring(0, 8000)}`
      }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();
  const clean = text.replace(/^```json\s*/,"").replace(/^```\s*/,"").replace(/\s*```$/,"").trim();
  return JSON.parse(clean);
}

async function saveSummary(jobId, result) {
  await pool.query(`
    INSERT INTO summaries (job_id, headline, subtitle, summary_text, key_quotes_json, article_draft, seo_description)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    ON CONFLICT (job_id) DO UPDATE SET
      headline = EXCLUDED.headline,
      subtitle = EXCLUDED.subtitle,
      summary_text = EXCLUDED.summary_text,
      key_quotes_json = EXCLUDED.key_quotes_json,
      article_draft = EXCLUDED.article_draft,
      seo_description = EXCLUDED.seo_description,
      updated_at = NOW()
  `, [
    jobId,
    result.headline || null,
    result.subtitle || null,
    result.summary || null,
    JSON.stringify(result.key_quotes || []),
    result.article_draft || null,
    result.seo_description || null,
  ]);
}

async function processJob(job) {
  console.log(`[llm-worker] Processing job ${job.id}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn("[llm-worker] ANTHROPIC_API_KEY not set — skipping LLM.");
    return;
  }
  try {
    const result = await callClaude(job.clean_text);
    await saveSummary(job.id, result);
    console.log(`[llm-worker] Done: ${job.id} — "${result.headline}"`);
  } catch (err) {
    console.error(`[llm-worker] Failed ${job.id}:`, err.message);
    // Insert a placeholder so we don't retry endlessly
    await pool.query(`
      INSERT INTO summaries (job_id, headline)
      VALUES ($1, 'Analysis unavailable')
      ON CONFLICT (job_id) DO NOTHING
    `, [job.id]);
  }
}

async function poll() {
  try {
    const job = await getPendingJob();
    if (job) await processJob(job);
  } catch (err) {
    console.error("[llm-worker] Poll error:", err.message);
  }
  setTimeout(poll, POLL_INTERVAL);
}

async function boot() {
  let retries = 15;
  while (retries > 0) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      retries--;
      if (retries === 0) { console.error("[llm-worker] DB never ready."); process.exit(1); }
      console.log(`[llm-worker] Waiting for DB... (${retries} left)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.log("[llm-worker] Connected. Polling for completed jobs...");
  poll();
}

boot();

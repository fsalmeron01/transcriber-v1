"use strict";

const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const POLL_INTERVAL = 15000;

async function getPendingJob() {
  const result = await pool.query(`
    SELECT j.id, j.title, t.clean_text, t.language
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

const SMART_MODE_PROMPT = (title, transcript) => `You are the Camden Tribune Smart Mode v2 AI editor — a veteran local newsroom editor for Camden Tribune, an independent local news outlet covering Camden County, NC.

Your job is to analyze this transcript and produce a complete, publication-ready newsroom package following Camden Tribune's Smart Mode v2 editorial system.

VIDEO TITLE: ${title || "Unknown"}

TRANSCRIPT (first 7000 chars):
${transcript.substring(0, 7000)}

---

STEP 1: Detect the story mode from this list:
- breaking_news (Breaking events, emergencies)
- government_watch (Government votes, budgets, policy)
- investigative (Records, lawsuits, audits)
- public_safety (Safety hazards, law enforcement)
- education_beat (School board, construction, education policy)
- election_campaign (Elections, candidates)
- community_event (Festivals, fundraisers)
- seasonal_feature (Parks, trails, destinations)
- restaurant_feature (Restaurants, dining)
- human_interest (Profiles, milestones)
- obituary_memorial (Deaths, tributes)
- hidden_gem (Overlooked places)

STEP 2: Apply the 7-point writing audit to your article:
1. No explanation addiction — report, don't lecture
2. No talking heads — quotes grounded in events or records
3. No POV drift — every sentence traces to observable fact
4. Stakes landed — reader knows why it matters within 3 paragraphs
5. Pacing holds — paragraphs capped at 2 sentences
6. Start at impact — open at the moment of action, not background
7. No overwriting — strong verbs, earned adjectives, necessary sentences only

STEP 3: Produce the complete output package as a single JSON object with EXACTLY these fields:

{
  "mode": "government_watch",
  "mode_emoji": "🏛️",
  "mode_label": "Government Watch",

  "headline": "Camden Commissioners Approve $2.1M Road Package Over Resident Objections",
  "subtitle": "Board votes 4-1 to move forward despite concerns over drainage and construction timeline",
  "summary": "A 3-4 sentence factual summary of what happened and why it matters to Camden County residents.",
  "newspack_excerpt": "One or two sentence homepage/social preview under 160 characters.",
  "article": "Full AP-style news article following the structure for the detected mode. Each paragraph is separated by a blank line. Two-sentence paragraph cap. Lead with the moment of action. Include named sources, dollar amounts, vote counts, and specific facts from the transcript. 600-1000 words for government/education, 300-500 for breaking/safety.",

  "key_quotes": [
    "Exact verbatim quote from transcript",
    "Another exact quote",
    "Third quote"
  ],

  "categories": ["Local & Regional News", "Government", "Camden County"],
  "tags": ["Camden County", "Board of Commissioners", "budget", "South Mills"],

  "yoast": {
    "seo_title": "Under 60 chars — Camden Commissioners Approve Road Package",
    "slug": "camden-commissioners-road-package-2026",
    "meta_description": "Under 155 chars — Camden County commissioners voted 4-1 to approve a $2.1M road improvement package despite resident concerns over drainage.",
    "focus_keyphrase": "Camden commissioners road package",
    "keyphrase_in_intro": true,
    "keyphrase_in_meta": true,
    "keyphrase_in_slug": true
  },

  "headline_heat_score": 82,
  "headline_heat_label": "⚡ Strong",
  "headline_heat_breakdown": {
    "specificity": 22,
    "reader_stakes": 20,
    "power_language": 18,
    "urgency": 12,
    "emotional_resonance": 10
  },

  "seo_strength_score": 8,
  "seo_checks": {
    "keyphrase_in_first_100_words": true,
    "keyphrase_in_seo_title": true,
    "keyphrase_in_slug": true,
    "keyphrase_in_meta": true,
    "seo_title_under_60": true,
    "meta_under_155": true,
    "slug_clean": true,
    "search_intent_match": true,
    "subheadings_have_keywords": false
  },

  "legal_risk_level": "low",
  "legal_flags": [],

  "readability": {
    "two_sentence_cap": true,
    "active_voice": true,
    "no_speculation": true,
    "attribution_present": true,
    "pacing": "Good — article moves efficiently through key decisions",
    "grade_level": "Grade 10",
    "tone": "Firm, factual, taxpayer-focused"
  },

  "photo_guidance": "Suggested photo: Exterior of Camden County Administration Building during a commissioners meeting. Frame: wide establishing shot showing commissioners at the dais. Mood: formal, institutional. Credit: Camden Tribune staff photo."
}

CRITICAL RULES:
- Return ONLY valid JSON. No markdown. No code fences. No preamble. No explanation.
- The article field must be a full publication-ready news story, NOT a placeholder.
- All quotes must be exact words from the transcript, not paraphrased.
- Apply the 7-point audit. If a paragraph fails, rewrite it before including it.
- Headline heat: score below 70 means auto-rewrite the headline and try again.
- Legal risk: flag any unverified accusations, missing attribution, or loaded language.
- For government/education stories: include vote counts, dollar amounts, named officials.
- For all modes: lead with the moment of action, not background context.`;

async function callClaude(job) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: SMART_MODE_PROMPT(job.title, job.clean_text),
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(text);
}

async function saveSummary(jobId, r) {
  // Headline heat label
  const score = r.headline_heat_score || 0;
  const heatLabel = score >= 90 ? "🔥 Exceptional" :
                    score >= 70 ? "⚡ Strong" :
                    score >= 50 ? "🟡 Moderate" : "❄️ Weak";

  await pool.query(`
    INSERT INTO summaries (
      job_id, mode, mode_emoji,
      headline, subtitle, summary_text, newspack_excerpt, article_draft, key_quotes_json,
      categories_json, tags_json,
      yoast_json,
      headline_heat_score, headline_heat_label,
      seo_strength_score,
      legal_risk_level, legal_flags_json,
      readability_json,
      photo_guidance
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19)
    ON CONFLICT (job_id) DO UPDATE SET
      mode=EXCLUDED.mode, mode_emoji=EXCLUDED.mode_emoji,
      headline=EXCLUDED.headline, subtitle=EXCLUDED.subtitle,
      summary_text=EXCLUDED.summary_text, newspack_excerpt=EXCLUDED.newspack_excerpt,
      article_draft=EXCLUDED.article_draft, key_quotes_json=EXCLUDED.key_quotes_json,
      categories_json=EXCLUDED.categories_json, tags_json=EXCLUDED.tags_json,
      yoast_json=EXCLUDED.yoast_json,
      headline_heat_score=EXCLUDED.headline_heat_score, headline_heat_label=EXCLUDED.headline_heat_label,
      seo_strength_score=EXCLUDED.seo_strength_score,
      legal_risk_level=EXCLUDED.legal_risk_level, legal_flags_json=EXCLUDED.legal_flags_json,
      readability_json=EXCLUDED.readability_json,
      photo_guidance=EXCLUDED.photo_guidance,
      updated_at=NOW()
  `, [
    jobId,
    r.mode || "general", r.mode_emoji || "📰",
    r.headline || null, r.subtitle || null,
    r.summary || null, r.newspack_excerpt || null,
    r.article || null,
    JSON.stringify(r.key_quotes || []),
    JSON.stringify(r.categories || []),
    JSON.stringify(r.tags || []),
    JSON.stringify(r.yoast || {}),
    r.headline_heat_score || null, heatLabel,
    r.seo_strength_score || null,
    r.legal_risk_level || "unknown",
    JSON.stringify(r.legal_flags || []),
    JSON.stringify(r.readability || {}),
    r.photo_guidance || null,
  ]);
}

async function processJob(job) {
  console.log(`[llm-worker] Processing job ${job.id} — "${job.title}"`);
  if (!ANTHROPIC_API_KEY) {
    console.warn("[llm-worker] ANTHROPIC_API_KEY not set — skipping.");
    return;
  }
  try {
    const result = await callClaude(job);
    await saveSummary(job.id, result);
    console.log(`[llm-worker] ✓ ${job.id} — "${result.headline}" (${result.mode}) Heat:${result.headline_heat_score} SEO:${result.seo_strength_score}/9 Legal:${result.legal_risk_level}`);
  } catch (err) {
    console.error(`[llm-worker] ✕ ${job.id}:`, err.message);
    await pool.query(`
      INSERT INTO summaries (job_id, headline, mode)
      VALUES ($1, 'Analysis unavailable', 'error')
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
    try { await pool.query("SELECT 1"); break; }
    catch {
      retries--;
      if (retries === 0) { console.error("[llm-worker] DB never ready."); process.exit(1); }
      console.log(`[llm-worker] Waiting for DB... (${retries} left)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.log("[llm-worker] Connected. Smart Mode v2 active. Polling...");
  poll();
}

boot();

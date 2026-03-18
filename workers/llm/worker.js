"use strict";

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } = require("docx");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STORAGE_ROOT = process.env.STORAGE_ROOT || "/data";
const POLL_INTERVAL = 15000;

const CONTENT_MODES = {
  "camden-tribune": {
    label: "Camden Tribune",
    instruction: `You are a staff reporter for Camden Tribune, an independent local news outlet based in Camden County, NC.

GEOGRAPHIC INTELLIGENCE — apply this automatically:
- If the content is about Camden County, NC specifically → write with full local framing. Name commissioners, reference Camden County taxpayers, connect to local impact.
- If the content is about neighboring counties (Currituck, Pasquotank, Perquimans, Gates, Chowan, Dare, Hertford) or northeastern NC broadly → write with a regional framing. Note the proximity and relevance to Camden Tribune readers.
- If the content is about North Carolina state government, policy, or issues → write with a statewide framing, noting NC-specific impact.
- If the content is national news → write as a national story with local relevance noted where it exists. Do not force Camden County framing where it does not belong.

Always apply AP style. Always lead with the most newsworthy fact. Always attribute claims to sources.`,
  },
  "meeting": {
    label: "Public Meeting",
    instruction: "This is a public meeting recording. Identify the governing body, jurisdiction, and date. Focus on decisions made, votes taken, dollar amounts, and public impact. Document who said what. Apply AP style. Note the geographic scope automatically.",
  },
  "interview": {
    label: "Interview",
    instruction: "This is an interview. Extract the key narrative, most compelling quotes, and main takeaways. Identify the subject and their relevance. Structure as a profile or Q&A-inspired article. Apply AP style.",
  },
  "podcast": {
    label: "Podcast",
    instruction: "This is a podcast episode. Summarize the main topics discussed, key insights, and notable quotes. Tone: engaging and accessible. Note the geographic scope if relevant.",
  },
  "news": {
    label: "News",
    instruction: "This is general news content. Apply standard AP style journalism. Lead with the most newsworthy fact. Attribute all claims. Determine geographic scope from the content itself.",
  },
  "generic": {
    label: "Generic",
    instruction: "Produce a clean, accurate summary and article draft from this content. Use clear, professional language. Determine the appropriate framing and geographic scope from the content.",
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getJobDir(jobId) {
  const dir = path.join(STORAGE_ROOT, "jobs", jobId, "downloads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function insertArtifact(jobId, artifactType, filePath, mimeType) {
  const stat = fs.statSync(filePath);
  await pool.query(
    `INSERT INTO artifacts (job_id, artifact_type, file_path, file_name, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [jobId, artifactType, filePath, path.basename(filePath), mimeType, stat.size]
  );
}

// ─── Article DOCX generator ─────────────────────────────────────────────────

async function buildArticleDocx(jobId, job, result) {
  const outputDir = getJobDir(jobId);
  const filePath = path.join(outputDir, `${jobId}-article.docx`);

  const children = [];

  // Publication header
  children.push(new Paragraph({
    children: [new TextRun({ text: "Camden Tribune", bold: true, size: 28, color: "2E4D6B" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
  }));

  children.push(new Paragraph({
    children: [new TextRun({ text: "lede.camdentribune.com", size: 18, color: "888888", italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }));

  // Headline
  children.push(new Paragraph({
    text: result.headline || "Untitled",
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 160 },
  }));

  // Subtitle
  if (result.subtitle) {
    children.push(new Paragraph({
      children: [new TextRun({ text: result.subtitle, italics: true, size: 26, color: "444444" })],
      spacing: { after: 160 },
    }));
  }

  // Byline / metadata
  const now = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "By: ", bold: true, size: 20 }),
      new TextRun({ text: "[Reporter Name]", size: 20, color: "888888" }),
      new TextRun({ text: "   |   ", size: 20, color: "CCCCCC" }),
      new TextRun({ text: now, size: 20, color: "888888" }),
      new TextRun({ text: "   |   ", size: 20, color: "CCCCCC" }),
      new TextRun({ text: `Mode: ${result.mode_label || result.mode || ""}`, size: 20, color: "888888" }),
    ],
    spacing: { after: 80 },
  }));

  // Divider
  children.push(new Paragraph({ text: "────────────────────────────────", spacing: { after: 320 }, alignment: AlignmentType.CENTER }));

  // Article body
  const paragraphs = (result.article || "").split("\n\n").filter(p => p.trim());
  for (const para of paragraphs) {
    children.push(new Paragraph({
      children: [new TextRun({ text: para.trim(), size: 24 })],
      spacing: { after: 240 },
      alignment: AlignmentType.JUSTIFIED,
    }));
  }

  // Key quotes section
  if (result.key_quotes?.length > 0) {
    children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
    children.push(new Paragraph({ text: "KEY QUOTES", heading: HeadingLevel.HEADING_2, spacing: { after: 160 } }));
    for (const quote of result.key_quotes) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `"${quote}"`, italics: true, size: 22, color: "2E4D6B" })],
        spacing: { after: 160 },
        indent: { left: 720 },
      }));
    }
  }

  // SEO section
  children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
  children.push(new Paragraph({ text: "SEO & PUBLICATION NOTES", heading: HeadingLevel.HEADING_2, spacing: { after: 160 } }));

  const yoast = result.yoast || {};
  const seoFields = [
    ["SEO Title",       yoast.seo_title],
    ["Slug",            yoast.slug],
    ["Meta Description",yoast.meta_description],
    ["Focus Keyphrase", yoast.focus_keyphrase],
    ["Categories",      (result.categories || []).join(", ")],
    ["Tags",            (result.tags || []).join(", ")],
  ];

  for (const [label, value] of seoFields) {
    if (value) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: 20 }),
          new TextRun({ text: value, size: 20 }),
        ],
        spacing: { after: 100 },
      }));
    }
  }

  // Source info
  children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "Generated by Lede · Camden Tribune Media Intelligence · ", size: 18, color: "AAAAAA", italics: true }),
      new TextRun({ text: now, size: 18, color: "AAAAAA", italics: true }),
    ],
    spacing: { after: 100 },
  }));

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// ─── JSON package generator ──────────────────────────────────────────────────

function buildJsonPackage(jobId, job, result) {
  const outputDir = getJobDir(jobId);
  const filePath = path.join(outputDir, `${jobId}-package.json`);

  const pkg = {
    _meta: {
      generated_by: "Lede · Camden Tribune Media Intelligence",
      generated_at: new Date().toISOString(),
      job_id: jobId,
      source_url: job.source_url,
      source_type: job.source_type,
      content_mode: job.content_mode,
      title: job.title,
    },
    story: {
      headline:         result.headline,
      subtitle:         result.subtitle,
      summary:          result.summary,
      newspack_excerpt: result.newspack_excerpt,
      article:          result.article,
      key_quotes:       result.key_quotes || [],
    },
    wordpress: {
      categories: result.categories || [],
      tags:       result.tags || [],
      excerpt:    result.newspack_excerpt || result.summary || "",
    },
    yoast: result.yoast || {},
    scores: {
      headline_heat_score:  result.headline_heat_score,
      headline_heat_label:  result.headline_heat_label,
      seo_strength_score:   result.seo_strength_score,
      legal_risk_level:     result.legal_risk_level,
      legal_flags:          result.legal_flags || [],
    },
    readability: result.readability || {},
    photo_guidance: result.photo_guidance || null,
  };

  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2), "utf8");
  return filePath;
}

// ─── Newsletter HTML generator ───────────────────────────────────────────────

function buildNewsletterHtml(jobId, job, result) {
  const outputDir = getJobDir(jobId);
  const filePath = path.join(outputDir, `${jobId}-newsletter.html`);

  const paragraphs = (result.article || "").split("\n\n").filter(p => p.trim());
  const firstPara = paragraphs[0] || "";
  const restParas = paragraphs.slice(1);

  const quoteBlocks = (result.key_quotes || []).slice(0, 2).map(q => `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
      <tr>
        <td style="border-left: 4px solid #4a6d8c; padding: 12px 20px; background: #f0f4f8;">
          <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #2e4d6b; font-style: italic; font-family: Georgia, serif;">"${q}"</p>
        </td>
      </tr>
    </table>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${result.headline || "Camden Tribune"}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr>
    <td style="background:#2e4d6b;padding:24px 32px;border-bottom:4px solid #b83232;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p style="margin:0;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.6);font-family:Arial,sans-serif;">Camden</p>
            <p style="margin:0;font-size:26px;font-weight:900;color:#ffffff;font-family:Georgia,serif;line-height:1;">Tribune</p>
          </td>
          <td align="right">
            <p style="margin:0;font-size:13px;font-style:italic;color:rgba(255,255,255,0.7);font-family:Georgia,serif;">Local News. Independent Reporting.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Headline block -->
  <tr>
    <td style="padding:32px 32px 0;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#4a6d8c;font-family:Arial,sans-serif;">${(result.mode_label || result.mode || "").replace(/_/g, " ")}</p>
      <h1 style="margin:0 0 12px;font-size:28px;font-weight:900;line-height:1.15;color:#1a1a1a;font-family:Georgia,serif;">${result.headline || ""}</h1>
      ${result.subtitle ? `<p style="margin:0 0 20px;font-size:17px;color:#555;font-style:italic;font-family:Georgia,serif;line-height:1.5;">${result.subtitle}</p>` : ""}
      <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0;" />
    </td>
  </tr>

  <!-- Summary box -->
  ${result.summary ? `
  <tr>
    <td style="padding:0 32px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#f0f4f8;border-left:4px solid #2e4d6b;padding:16px 20px;border-radius:0 6px 6px 0;">
            <p style="margin:0 0 6px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#4a6d8c;font-family:Arial,sans-serif;">Summary</p>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#333;font-family:Arial,sans-serif;">${result.summary}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>` : ""}

  <!-- First paragraph (lede) -->
  <tr>
    <td style="padding:0 32px 16px;">
      <p style="margin:0;font-size:16px;line-height:1.8;color:#222;font-family:Georgia,serif;font-weight:500;">${firstPara}</p>
    </td>
  </tr>

  <!-- Quote block(s) -->
  ${quoteBlocks ? `<tr><td style="padding:0 32px;">${quoteBlocks}</td></tr>` : ""}

  <!-- Rest of article -->
  ${restParas.slice(0, 4).map(p => `
  <tr>
    <td style="padding:0 32px 16px;">
      <p style="margin:0;font-size:15px;line-height:1.8;color:#333;font-family:Georgia,serif;">${p}</p>
    </td>
  </tr>`).join("")}

  <!-- Read more CTA -->
  <tr>
    <td style="padding:24px 32px;">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#2e4d6b;border-radius:6px;padding:12px 24px;">
            <a href="https://camdentribune.com" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;font-family:Arial,sans-serif;">Read Full Story on Camden Tribune →</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#f8f8f8;padding:20px 32px;border-top:1px solid #e0e0e0;">
      <p style="margin:0 0 6px;font-size:12px;color:#888;font-family:Arial,sans-serif;">
        <strong style="color:#2e4d6b;">Camden Tribune</strong> · Local News. Independent Reporting.
      </p>
      <p style="margin:0;font-size:11px;color:#aaa;font-family:Arial,sans-serif;">
        Generated by Lede · Camden Tribune Media Intelligence · ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>

</body>
</html>`;

  fs.writeFileSync(filePath, html, "utf8");
  return filePath;
}

// ─── DB operations ───────────────────────────────────────────────────────────

async function getPendingJob() {
  const result = await pool.query(`
    SELECT j.id, j.title, j.content_mode, j.source_url, j.source_type, t.clean_text, t.language
    FROM jobs j
    JOIN transcripts t ON t.job_id = j.id
    LEFT JOIN summaries s ON s.job_id = j.id
    WHERE j.status = 'generating-article'
      AND t.clean_text IS NOT NULL
      AND t.clean_text != ''
      AND s.id IS NULL
    ORDER BY j.updated_at ASC
    LIMIT 1
  `);
  return result.rows[0] || null;
}

function buildPrompt(job) {
  const mode = CONTENT_MODES[job.content_mode] || CONTENT_MODES["generic"];
  return `You are the Camden Tribune Smart Mode v2 AI editor — a veteran local newsroom editor.

CONTENT MODE: ${mode.label}
${mode.instruction}

VIDEO TITLE: ${job.title || "Unknown"}

TRANSCRIPT:
${job.clean_text.substring(0, 7000)}

---

INSTRUCTIONS:

1. Detect the story mode: breaking_news | government_watch | investigative | public_safety | education_beat | election_campaign | community_event | seasonal_feature | restaurant_feature | human_interest | obituary_memorial | hidden_gem

2. Apply the 7-point writing audit:
   - No explanation addiction — report, don't lecture
   - No talking heads — quotes grounded in events
   - No POV drift — every sentence traces to fact
   - Stakes landed within 3 paragraphs
   - Two-sentence paragraph cap
   - Start at impact, not background
   - No overwriting — strong verbs, earned adjectives

3. Return ONLY valid JSON, no markdown, no code fences:

{
  "mode": "government_watch",
  "mode_emoji": "🏛️",
  "mode_label": "Government Watch",
  "headline": "Compelling headline under 12 words",
  "subtitle": "Supporting subheadline under 20 words",
  "summary": "3-4 sentence factual summary.",
  "newspack_excerpt": "1-2 sentence homepage preview under 160 characters.",
  "article": "Full AP-style article. Paragraphs separated by blank lines. Two-sentence cap. Lead with action. 600-1000 words for government/education, 300-500 for breaking/safety.",
  "key_quotes": ["Exact verbatim quote 1", "Exact verbatim quote 2", "Exact verbatim quote 3"],
  "categories": ["Local & Regional News", "Government", "Camden County"],
  "tags": ["Camden County", "Board of Commissioners"],
  "yoast": {
    "seo_title": "Under 60 chars",
    "slug": "keyword-rich-slug",
    "meta_description": "Under 155 chars",
    "focus_keyphrase": "primary keyphrase",
    "keyphrase_in_intro": true,
    "keyphrase_in_meta": true,
    "keyphrase_in_slug": true
  },
  "headline_heat_score": 82,
  "headline_heat_label": "⚡ Strong",
  "seo_strength_score": 8,
  "legal_risk_level": "low",
  "legal_flags": [],
  "readability": {
    "two_sentence_cap": true,
    "active_voice": true,
    "no_speculation": true,
    "attribution_present": true,
    "pacing": "Good",
    "grade_level": "Grade 10",
    "tone": "Firm, factual, taxpayer-focused"
  },
  "photo_guidance": "Suggested photo description, framing, mood, and credit guidance.",
  "geographic_scope": "local_camden | regional_nc | statewide_nc | national",
  "geographic_note": "One sentence explaining why this story matters to Camden Tribune readers specifically."
}`;
}

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
      messages: [{ role: "user", content: buildPrompt(job) }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(text);
}

async function saveSummary(jobId, r) {
  await pool.query(`
    INSERT INTO summaries (
      job_id, mode, mode_emoji,
      headline, subtitle, summary_text, newspack_excerpt, article_draft, key_quotes_json,
      categories_json, tags_json, yoast_json,
      headline_heat_score, headline_heat_label, seo_strength_score,
      legal_risk_level, legal_flags_json, readability_json, photo_guidance
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
      readability_json=EXCLUDED.readability_json, photo_guidance=EXCLUDED.photo_guidance,
      updated_at=NOW()
  `, [
    jobId,
    r.mode || "generic", r.mode_emoji || "📰",
    r.headline, r.subtitle,
    r.summary, r.newspack_excerpt,
    r.article,
    JSON.stringify(r.key_quotes || []),
    JSON.stringify(r.categories || []),
    JSON.stringify(r.tags || []),
    JSON.stringify(r.yoast || {}),
    r.headline_heat_score, r.headline_heat_label,
    r.seo_strength_score,
    r.legal_risk_level || "unknown",
    JSON.stringify(r.legal_flags || []),
    JSON.stringify(r.readability || {}),
    r.photo_guidance,
  ]);
}

async function generateArtifacts(jobId, job, result) {
  const errors = [];

  // 1. Article DOCX
  try {
    const filePath = await buildArticleDocx(jobId, job, result);
    await insertArtifact(jobId, "article_docx", filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    console.log(`[llm] ✓ Article DOCX generated`);
  } catch (err) {
    errors.push(`Article DOCX: ${err.message}`);
    console.error(`[llm] Article DOCX failed:`, err.message);
  }

  // 2. JSON package
  try {
    const filePath = buildJsonPackage(jobId, job, result);
    await insertArtifact(jobId, "json_package", filePath, "application/json");
    console.log(`[llm] ✓ JSON package generated`);
  } catch (err) {
    errors.push(`JSON package: ${err.message}`);
    console.error(`[llm] JSON package failed:`, err.message);
  }

  // 3. Newsletter HTML
  try {
    const filePath = buildNewsletterHtml(jobId, job, result);
    await insertArtifact(jobId, "newsletter_html", filePath, "text/html");
    console.log(`[llm] ✓ Newsletter HTML generated`);
  } catch (err) {
    errors.push(`Newsletter HTML: ${err.message}`);
    console.error(`[llm] Newsletter HTML failed:`, err.message);
  }

  if (errors.length > 0) {
    console.warn(`[llm] Artifact generation warnings:`, errors.join("; "));
  }
}

async function processJob(job) {
  console.log(`[llm] Job ${job.id} — mode: ${job.content_mode} — "${job.title}"`);

  if (!ANTHROPIC_API_KEY) {
    console.warn("[llm] ANTHROPIC_API_KEY not set — marking complete without analysis.");
    await pool.query(`UPDATE jobs SET status='completed', progress=100 WHERE id=$1`, [job.id]);
    return;
  }

  try {
    const result = await callClaude(job);
    await saveSummary(job.id, result);
    await generateArtifacts(job.id, job, result);
    await pool.query(`UPDATE jobs SET status='completed', progress=100 WHERE id=$1`, [job.id]);
    console.log(`[llm] ✓ ${job.id} — "${result.headline}" Heat:${result.headline_heat_score} SEO:${result.seo_strength_score}/9 Legal:${result.legal_risk_level}`);
  } catch (err) {
    console.error(`[llm] ✕ ${job.id}:`, err.message);
    await pool.query(
      `INSERT INTO summaries (job_id, headline, mode) VALUES ($1,'Analysis unavailable','error') ON CONFLICT (job_id) DO NOTHING`,
      [job.id]
    );
    await pool.query(`UPDATE jobs SET status='completed', progress=100 WHERE id=$1`, [job.id]);
  }
}

async function poll() {
  try {
    const job = await getPendingJob();
    if (job) await processJob(job);
  } catch (err) {
    console.error("[llm] Poll error:", err.message);
  }
  setTimeout(poll, POLL_INTERVAL);
}

async function boot() {
  let retries = 15;
  while (retries > 0) {
    try { await pool.query("SELECT 1"); break; }
    catch {
      retries--;
      if (retries === 0) { process.exit(1); }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.log(`[llm] Smart Mode v2 active. Modes: ${Object.keys(CONTENT_MODES).join(", ")}`);
  poll();
}

boot();

const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { Queue } = require("bullmq");
const mime = require("mime-types");

const MEDIA_QUEUE_NAME = "media-jobs";
const TRANSCRIBE_QUEUE_NAME = "transcribe-jobs";

let poolInstance;
function getPool() {
  if (!poolInstance) {
    poolInstance = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return poolInstance;
}

function getStorageRoot() {
  return process.env.STORAGE_ROOT || "/data";
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function getJobDir(jobId) {
  return ensureDir(path.join(getStorageRoot(), "jobs", jobId));
}

function getDownloadsDir(jobId) {
  return ensureDir(path.join(getJobDir(jobId), "downloads"));
}

function getWorkingDir(jobId) {
  return ensureDir(path.join(getJobDir(jobId), "work"));
}

function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
  return { url: redisUrl, maxRetriesPerRequest: null };
}

function getQueue(queueName) {
  return new Queue(queueName, { connection: getRedisConnection() });
}

async function createJob({ sourceUrl, sourceType, requestedOutputs }) {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO jobs (source_url, source_type, requested_outputs, status, progress)
     VALUES ($1, $2, $3::jsonb, 'queued', 0)
     RETURNING *`,
    [sourceUrl, sourceType, JSON.stringify(requestedOutputs)]
  );
  return result.rows[0];
}

async function getJob(jobId) {
  const pool = getPool();
  const jobRes = await pool.query(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
  if (jobRes.rowCount === 0) return null;
  const job = jobRes.rows[0];

  const artifactsRes = await pool.query(
    `SELECT * FROM artifacts WHERE job_id = $1 ORDER BY created_at ASC`,
    [jobId]
  );
  const transcriptRes = await pool.query(
    `SELECT * FROM transcripts WHERE job_id = $1`,
    [jobId]
  );
  const summaryRes = await pool.query(
    `SELECT * FROM summaries WHERE job_id = $1`,
    [jobId]
  );

  job.artifacts = artifactsRes.rows;
  job.transcript = transcriptRes.rows[0] || null;
  job.summary = summaryRes.rows[0] || null;
  return job;
}

async function updateJob(jobId, patch = {}) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const setFragments = [];
  const values = [];
  let idx = 1;
  for (const key of keys) {
    setFragments.push(`${key} = $${idx}`);
    values.push(patch[key]);
    idx++;
  }
  values.push(jobId);
  const pool = getPool();
  await pool.query(
    `UPDATE jobs SET ${setFragments.join(", ")} WHERE id = $${idx}`,
    values
  );
}

async function insertArtifact({ jobId, artifactType, filePath, fileName, mimeType, sizeBytes }) {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO artifacts (job_id, artifact_type, file_path, file_name, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [jobId, artifactType, filePath, fileName, mimeType, sizeBytes]
  );
  return result.rows[0];
}

async function upsertTranscript({ jobId, language, rawText, cleanText, segmentsJson }) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO transcripts (job_id, language, raw_text, clean_text, segments_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (job_id) DO UPDATE SET
       language = EXCLUDED.language,
       raw_text = EXCLUDED.raw_text,
       clean_text = EXCLUDED.clean_text,
       segments_json = EXCLUDED.segments_json`,
    [jobId, language, rawText, cleanText, JSON.stringify(segmentsJson || [])]
  );
}

function detectSourceType(url) {
  const value = (url || "").toLowerCase();
  if (value.includes("youtube.com") || value.includes("youtu.be")) return "youtube";
  if (value.includes("vimeo.com")) return "vimeo";
  return "unknown";
}

function validateSourceUrl(url) {
  if (!url || typeof url !== "string") return "A source URL is required.";
  if (url.length > Number(process.env.MAX_SOURCE_URL_LENGTH || 2048)) return "The URL is too long.";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "Only HTTP and HTTPS URLs are allowed.";
  } catch {
    return "The URL is not valid.";
  }
  const sourceType = detectSourceType(url);
  if (!["youtube", "vimeo"].includes(sourceType)) return "Only YouTube and Vimeo URLs are supported in V1.";
  return null;
}

function getMimeTypeForFile(filePath) {
  return mime.lookup(filePath) || "application/octet-stream";
}

// SRT formatter
function formatSRT(segments) {
  if (!segments || segments.length === 0) return "";
  function toSRTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
  }
  return segments.map((seg, i) => (
    `${i + 1}\n${toSRTTime(seg.start)} --> ${toSRTTime(seg.end)}\n${seg.text.trim()}\n`
  )).join("\n");
}

// VTT formatter
function formatVTT(segments) {
  if (!segments || segments.length === 0) return "WEBVTT\n";
  function toVTTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(ms).padStart(3,"0")}`;
  }
  const cues = segments.map((seg, i) => (
    `${i + 1}\n${toVTTTime(seg.start)} --> ${toVTTTime(seg.end)}\n${seg.text.trim()}\n`
  )).join("\n");
  return `WEBVTT\n\n${cues}`;
}

module.exports = {
  MEDIA_QUEUE_NAME,
  TRANSCRIBE_QUEUE_NAME,
  createJob,
  detectSourceType,
  ensureDir,
  formatSRT,
  formatVTT,
  getDownloadsDir,
  getJob,
  getJobDir,
  getMimeTypeForFile,
  getPool,
  getQueue,
  getRedisConnection,
  getStorageRoot,
  getWorkingDir,
  insertArtifact,
  updateJob,
  upsertTranscript,
  validateSourceUrl,
};

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Worker } = require("bullmq");
const { createClient } = require("redis");
const {
  MEDIA_QUEUE_NAME,
  getDownloadsDir,
  getJob,
  getPool,
  getRedisConnection,
  getWorkingDir,
  insertArtifact,
  updateJob,
} = require("@transcriber/shared");

const TRANSCRIBE_LIST_KEY = "transcribe:jobs";

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d.toString());
    child.stderr.on("data", d => stderr += d.toString());
    child.on("close", code => {
      if (code !== 0) { reject(new Error(`${command} exited ${code}\n${stderr}`)); return; }
      resolve({ stdout, stderr });
    });
  });
}

async function detectTitleAndFilename(sourceUrl, outputTemplate) {
  const result = await runCommand("yt-dlp", [
    "--print", "%(title)s", "--get-filename", "-o", outputTemplate, sourceUrl,
  ]);
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  return { title: lines[0] || null, filename: lines[1] || null };
}

async function enqueueTranscriptionJob(payload) {
  const client = createClient({ url: process.env.REDIS_URL || "redis://redis:6379" });
  await client.connect();
  try {
    await client.lPush(TRANSCRIBE_LIST_KEY, JSON.stringify(payload));
  } finally {
    await client.quit();
  }
}

async function processMediaJob(jobPayload) {
  const { jobId } = jobPayload.data;
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found.`);

  const workDir = getWorkingDir(jobId);
  const downloadsDir = getDownloadsDir(jobId);

  try {
    // Stage 1: Resolving source
    await updateJob(jobId, { status: "fetching", progress: 10 });

    let sourcePath;

    if (job.source_type === "direct") {
      console.log(`[media] Job ${jobId} — direct media URL`);
      await updateJob(jobId, { status: "fetching", progress: 20, title: "Direct media" });

      // Step 1: Download the stream to a temp file
      // Use .ts extension as universal container for HLS segments
      const dlPath = path.join(workDir, "source.ts");
      console.log(`[media] Job ${jobId} — downloading with universal ffmpeg flags`);
      await runCommand("ffmpeg", [
        "-y",
        "-allowed_extensions", "ALL",
        "-protocol_whitelist", "file,http,https,tcp,tls,crypto,data",
        "-analyzeduration", "20M",
        "-probesize", "20M",
        "-i", job.source_url,
        "-c", "copy",
        "-t", "14400",   // max 4 hours
        dlPath,
      ]);

      // Step 2: Find whatever file was actually created
      // (ffmpeg may use different extensions depending on stream type)
      const allFiles = fs.readdirSync(workDir)
        .map(n => path.join(workDir, n))
        .filter(f => fs.statSync(f).isFile() && fs.statSync(f).size > 0);

      if (allFiles.length === 0) {
        throw new Error("ffmpeg produced no output file — stream may be expired or inaccessible");
      }

      // Pick the largest file (the actual media, not any tiny metadata files)
      sourcePath = allFiles.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
      console.log(`[media] Job ${jobId} — downloaded: ${path.basename(sourcePath)} (${(fs.statSync(sourcePath).size / 1024 / 1024).toFixed(1)} MB)`);
    } else {
      // YouTube / Vimeo — use yt-dlp
      const outputTemplate = path.join(workDir, "source.%(ext)s");
      const { title } = await detectTitleAndFilename(job.source_url, outputTemplate);
      if (title) await updateJob(jobId, { title });
      console.log(`[media] Job ${jobId} — downloading: "${title}"`);

      // Stage 2: Downloading
      await updateJob(jobId, { status: "fetching", progress: 20 });
      await runCommand("yt-dlp", [
        "-f", process.env.YTDLP_FORMAT || "bestaudio/best",
        "-o", outputTemplate,
        job.source_url,
      ]);

      const downloadedFiles = fs.readdirSync(workDir).map(n => path.join(workDir, n));
      sourcePath = downloadedFiles.find(f => fs.statSync(f).isFile());
      if (!sourcePath) throw new Error("No source media file was downloaded.");
    }

    // Stage 3: Extracting audio
    await updateJob(jobId, { status: "extracting-audio", progress: 40 });
    console.log(`[media] Job ${jobId} — extracting audio`);
    const mp3Path = path.join(downloadsDir, `${jobId}.mp3`);
    await runCommand("ffmpeg", [
      "-y", "-i", sourcePath,
      "-vn", "-acodec", "libmp3lame", "-ab", "128k",
      mp3Path,
    ]);

    const mp3Stat = fs.statSync(mp3Path);
    if ((job.requested_outputs || []).includes("mp3")) {
      await insertArtifact({
        jobId,
        artifactType: "mp3",
        filePath: mp3Path,
        fileName: path.basename(mp3Path),
        mimeType: "audio/mpeg",
        sizeBytes: mp3Stat.size,
      });
    }

    // Stage 4: Queue for transcription
    await updateJob(jobId, { status: "queued-for-transcription", progress: 55 });
    console.log(`[media] Job ${jobId} — queued for transcription`);
    await enqueueTranscriptionJob({ jobId, mp3Path });

  } catch (error) {
    console.error(`[media] Job ${jobId} failed:`, error.message);
    await updateJob(jobId, { status: "failed", progress: 0, error_message: error.message });
    throw error;
  }
}

async function boot() {
  await getPool().query("SELECT 1");
  console.log("Media worker connected to PostgreSQL.");
  const worker = new Worker(MEDIA_QUEUE_NAME, processMediaJob, {
    connection: getRedisConnection(),
    concurrency: 2,
  });
  worker.on("completed", job => console.log(`[media] Job ${job.id} completed.`));
  worker.on("failed", (job, err) => console.error(`[media] Job ${job?.id} failed:`, err.message));
  console.log("Media worker is listening...");
}

boot().catch(err => { console.error("Media worker failed to start:", err); process.exit(1); });

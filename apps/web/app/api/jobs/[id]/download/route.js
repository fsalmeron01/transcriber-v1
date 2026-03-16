import fs from "fs";
import path from "path";
import shared from "@transcriber/shared";

const { getJobDir, getMimeTypeForFile, getJob, formatSRT, formatVTT } = shared;

export async function GET(request, { params }) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format");

    // SRT / VTT — generated on the fly from transcript segments
    if (format === "srt" || format === "vtt") {
      const job = await getJob(params.id);
      if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
      if (!job.transcript?.segments_json) {
        return Response.json({ error: "Transcript not ready." }, { status: 404 });
      }
      const segments = Array.isArray(job.transcript.segments_json)
        ? job.transcript.segments_json
        : JSON.parse(job.transcript.segments_json);

      if (format === "srt") {
        const content = formatSRT(segments);
        return new Response(content, {
          status: 200,
          headers: {
            "Content-Type": "application/x-subrip",
            "Content-Disposition": `attachment; filename="transcript-${params.id}.srt"`,
          },
        });
      } else {
        const content = formatVTT(segments);
        return new Response(content, {
          status: 200,
          headers: {
            "Content-Type": "text/vtt",
            "Content-Disposition": `attachment; filename="transcript-${params.id}.vtt"`,
          },
        });
      }
    }

    // File-based downloads (mp3, txt, docx)
    const relPath = searchParams.get("path");
    if (!relPath) return Response.json({ error: "Missing file path." }, { status: 400 });

    const jobDir = getJobDir(params.id);
    const normalized = path.normalize(relPath);
    const absolutePath = path.resolve(normalized);

    if (!absolutePath.startsWith(jobDir)) {
      return Response.json({ error: "Invalid path." }, { status: 400 });
    }
    if (!fs.existsSync(absolutePath)) {
      return Response.json({ error: "File not found." }, { status: 404 });
    }

    const data = fs.readFileSync(absolutePath);
    const fileName = path.basename(absolutePath);
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": getMimeTypeForFile(absolutePath),
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    return Response.json({ error: "Unable to download file." }, { status: 500 });
  }
}

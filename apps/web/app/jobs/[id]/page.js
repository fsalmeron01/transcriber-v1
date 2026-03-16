"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const POLL_INTERVAL = 5000;

function statusColor(status) {
  if (status === "completed") return "#7df0ac";
  if (status === "failed") return "#ff9ea8";
  return "#ffd479";
}

function Section({ title, children }) {
  return (
    <section style={{
      background: "#121933",
      border: "1px solid #24305e",
      borderRadius: 18,
      padding: 28,
      marginBottom: 24,
    }}>
      <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 20 }}>{title}</h2>
      {children}
    </section>
  );
}

function DownloadButton({ href, label }) {
  return (
    <a
      href={href}
      style={{
        display: "inline-block",
        background: "#1e3a6e",
        color: "#8eb4ff",
        border: "1px solid #2d5299",
        borderRadius: 8,
        padding: "6px 14px",
        marginRight: 10,
        marginBottom: 8,
        textDecoration: "none",
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      ↓ {label}
    </a>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      style={{
        background: "transparent",
        border: "1px solid #2d5299",
        color: "#8eb4ff",
        borderRadius: 6,
        padding: "4px 12px",
        cursor: "pointer",
        fontSize: 13,
        marginLeft: 8,
      }}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

export default function JobPage() {
  const params = useParams();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("transcript");

  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${params.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setJob(data.job);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  useEffect(() => {
    if (!job) return;
    const done = job.status === "completed" || job.status === "failed";
    const llmDone = job.summary !== null;
    if (done && llmDone) return;
    const timer = setInterval(fetchJob, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [job, fetchJob]);

  if (loading) {
    return (
      <main style={{ maxWidth: 960, margin: "0 auto", padding: 40 }}>
        <p style={{ color: "#9fb1da" }}>Loading job...</p>
      </main>
    );
  }

  if (!job) {
    return (
      <main style={{ maxWidth: 960, margin: "0 auto", padding: 40 }}>
        <a href="/" style={{ color: "#8eb4ff" }}>← Back</a>
        <h1>Job not found</h1>
      </main>
    );
  }

  const isActive = job.status !== "completed" && job.status !== "failed";
  const hasSRT = job.transcript?.segments_json?.length > 0;
  const hasSummary = !!job.summary?.headline;

  const tabs = [
    { id: "transcript", label: "Transcript" },
    { id: "article", label: hasSummary ? "✦ Article Draft" : "Article Draft" },
    { id: "quotes", label: "Key Quotes" },
  ];

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 40 }}>
      <a href="/" style={{ color: "#8eb4ff", textDecoration: "none" }}>← Back</a>

      <div style={{ marginTop: 20, marginBottom: 8 }}>
        {job.summary?.headline ? (
          <h1 style={{ fontSize: 32, marginBottom: 4 }}>{job.summary.headline}</h1>
        ) : (
          <h1 style={{ fontSize: 22, color: "#9fb1da", marginBottom: 4 }}>
            Job {job.id.split("-")[0]}...
          </h1>
        )}
        {job.summary?.subtitle && (
          <p style={{ color: "#9fb1da", fontSize: 16, margin: "4px 0 0" }}>{job.summary.subtitle}</p>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <span style={{ color: statusColor(job.status), fontWeight: 700, fontSize: 14 }}>
          {job.status.toUpperCase()} • {job.progress}%
        </span>
        {isActive && (
          <span style={{ color: "#ffd479", fontSize: 13 }}>
            ↻ Auto-refreshing every 5s...
          </span>
        )}
        {!hasSummary && job.status === "completed" && (
          <span style={{ color: "#ffd479", fontSize: 13 }}>
            ✦ AI analysis in progress...
          </span>
        )}
      </div>

      {/* Request details */}
      <Section title="Request">
        <p style={{ margin: "4px 0" }}><strong>Source type:</strong> {job.source_type}</p>
        <p style={{ margin: "4px 0" }}><strong>Source URL:</strong>{" "}
          <a href={job.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "#8eb4ff" }}>
            {job.source_url}
          </a>
        </p>
        <p style={{ margin: "4px 0" }}><strong>Requested outputs:</strong> {(job.requested_outputs || []).join(", ")}</p>
        {job.title && <p style={{ margin: "4px 0" }}><strong>Title:</strong> {job.title}</p>}
        {job.error_message && (
          <p style={{ margin: "8px 0 0", color: "#ff9ea8" }}><strong>Error:</strong> {job.error_message}</p>
        )}
      </Section>

      {/* SEO description */}
      {job.summary?.seo_description && (
        <Section title="SEO Description">
          <p style={{ color: "#dbe5ff", lineHeight: 1.6, margin: 0 }}>
            {job.summary.seo_description}
            <CopyButton text={job.summary.seo_description} />
          </p>
        </Section>
      )}

      {/* Downloads */}
      <Section title="Downloads">
        {job.artifacts?.length ? (
          <div>
            {job.artifacts.map((a) => (
              <DownloadButton
                key={a.id}
                href={`/api/jobs/${job.id}/download?path=${encodeURIComponent(a.file_path)}`}
                label={a.file_name}
              />
            ))}
            {hasSRT && (
              <>
                <DownloadButton
                  href={`/api/jobs/${job.id}/download?format=srt`}
                  label="transcript.srt"
                />
                <DownloadButton
                  href={`/api/jobs/${job.id}/download?format=vtt`}
                  label="transcript.vtt"
                />
              </>
            )}
          </div>
        ) : (
          <p style={{ color: "#9fb1da" }}>No downloads yet.</p>
        )}
      </Section>

      {/* Tabbed content */}
      {(job.transcript || job.summary) && (
        <Section title="">
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid #24305e", paddingBottom: 0 }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: activeTab === tab.id ? "#1e3a6e" : "transparent",
                  color: activeTab === tab.id ? "#8eb4ff" : "#9fb1da",
                  border: "none",
                  borderBottom: activeTab === tab.id ? "2px solid #8eb4ff" : "2px solid transparent",
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: "6px 6px 0 0",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Transcript tab */}
          {activeTab === "transcript" && (
            <div>
              {job.transcript?.clean_text ? (
                <>
                  <div style={{ textAlign: "right", marginBottom: 8 }}>
                    <CopyButton text={job.transcript.clean_text} />
                  </div>
                  <pre style={{
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.7,
                    color: "#dbe5ff",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 14,
                    margin: 0,
                  }}>
                    {job.transcript.clean_text}
                  </pre>
                </>
              ) : (
                <p style={{ color: "#9fb1da" }}>Transcript not ready yet.</p>
              )}
            </div>
          )}

          {/* Article Draft tab */}
          {activeTab === "article" && (
            <div>
              {job.summary?.article_draft ? (
                <>
                  <div style={{ textAlign: "right", marginBottom: 12 }}>
                    <CopyButton text={job.summary.article_draft} />
                  </div>
                  {job.summary.summary_text && (
                    <div style={{
                      background: "#0d1428",
                      borderLeft: "3px solid #8eb4ff",
                      padding: "12px 16px",
                      marginBottom: 20,
                      borderRadius: "0 8px 8px 0",
                    }}>
                      <p style={{ margin: 0, color: "#9fb1da", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>SUMMARY</p>
                      <p style={{ margin: 0, color: "#dbe5ff", lineHeight: 1.7 }}>{job.summary.summary_text}</p>
                    </div>
                  )}
                  <div style={{ color: "#dbe5ff", lineHeight: 1.8, fontSize: 15 }}>
                    {job.summary.article_draft.split("\n\n").map((para, i) => (
                      <p key={i} style={{ marginBottom: 16 }}>{para}</p>
                    ))}
                  </div>
                </>
              ) : (
                <p style={{ color: "#9fb1da" }}>
                  {job.status === "completed"
                    ? "AI article draft is being generated... check back in a moment."
                    : "Article draft will be generated after transcription completes."}
                </p>
              )}
            </div>
          )}

          {/* Key Quotes tab */}
          {activeTab === "quotes" && (
            <div>
              {job.summary?.key_quotes_json?.length > 0 ? (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {job.summary.key_quotes_json.map((quote, i) => (
                    <li key={i} style={{
                      background: "#0d1428",
                      border: "1px solid #24305e",
                      borderLeft: "3px solid #7df0ac",
                      borderRadius: "0 8px 8px 0",
                      padding: "14px 16px",
                      marginBottom: 12,
                      color: "#dbe5ff",
                      lineHeight: 1.6,
                      fontSize: 15,
                    }}>
                      "{quote}"
                      <CopyButton text={`"${quote}"`} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: "#9fb1da" }}>
                  {job.status === "completed"
                    ? "Key quotes are being extracted..."
                    : "Key quotes will appear after transcription completes."}
                </p>
              )}
            </div>
          )}
        </Section>
      )}
    </main>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";

const OUTPUT_OPTIONS = [
  { id: "mp3",  label: "MP3",  desc: "Audio file" },
  { id: "txt",  label: "TXT",  desc: "Plain text" },
  { id: "docx", label: "DOCX", desc: "Word document" },
];

const CONTENT_MODES = [
  { id: "camden-tribune", label: "Camden Tribune", emoji: "📰", desc: "Full newsroom package" },
  { id: "meeting",        label: "Meeting",        emoji: "🏛️", desc: "Public meeting / BOC" },
  { id: "interview",      label: "Interview",      emoji: "🎙️", desc: "Interview / profile" },
  { id: "podcast",        label: "Podcast",        emoji: "🎧", desc: "Podcast episode" },
  { id: "news",           label: "News",           emoji: "📡", desc: "General news" },
  { id: "generic",        label: "Generic",        emoji: "📄", desc: "General transcript" },
];

const STATUS_LABELS = {
  "queued":                    "Queued",
  "fetching":                  "Downloading",
  "extracting-audio":          "Extracting audio",
  "queued-for-transcription":  "Awaiting transcription",
  "transcribing":              "Transcribing",
  "generating-article":        "Generating article",
  "completed":                 "Ready",
  "failed":                    "Failed",
};

const STUCK_STATUSES = ["fetching", "extracting-audio", "queued-for-transcription", "transcribing", "generating-article"];

// Thresholds per status — transcribing long meetings is slow on CPU
const STUCK_THRESHOLDS = {
  "fetching":                  20 * 60 * 1000,  // 20 min — download should finish
  "extracting-audio":          10 * 60 * 1000,  // 10 min — ffmpeg is fast
  "queued-for-transcription":  10 * 60 * 1000,  // 10 min — should pick up fast
  "transcribing":              90 * 60 * 1000,  // 90 min — CPU Whisper on 2hr meeting
  "generating-article":        15 * 60 * 1000,  // 15 min — Claude API call
};

function isStuck(job) {
  if (!STUCK_STATUSES.includes(job.status)) return false;
  const threshold = STUCK_THRESHOLDS[job.status] || 30 * 60 * 1000;
  const age = Date.now() - new Date(job.updated_at || job.created_at).getTime();
  return age > threshold;
}

function statusColor(s) {
  if (s === "completed") return "var(--green)";
  if (s === "failed")    return "var(--red-err)";
  return "var(--ct-blue-light)";
}
function statusDot(s) {
  if (s === "completed") return "✓";
  if (s === "failed")    return "✕";
  return "●";
}
function relativeTime(d) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (dy > 0) return `${dy}d ago`;
  if (h  > 0) return `${h}h ago`;
  if (m  > 0) return `${m}m ago`;
  return "just now";
}

export default function HomePage() {
  const [sourceUrl, setSourceUrl]     = useState("");
  const [outputs, setOutputs]         = useState({ mp3: false, txt: false, docx: true });
  const [contentMode, setContentMode] = useState("camden-tribune");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [newJob, setNewJob]           = useState(null);
  const [jobs, setJobs]               = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [deletingId, setDeletingId]   = useState(null);
  const [unstickingId, setUnstickingId] = useState(null);
  const [showCleanup, setShowCleanup] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(7);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [cleaningUp, setCleaningUp]   = useState(false);

  function toggle(name) { setOutputs(p => ({ ...p, [name]: !p[name] })); }

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (e) { console.error(e); }
    finally { setJobsLoading(false); }
  }, []);

  useEffect(() => {
    fetchJobs();
    const t = setInterval(fetchJobs, 8000);
    return () => clearInterval(t);
  }, [fetchJobs]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(""); setNewJob(null);
    const selected = Object.entries(outputs).filter(([, v]) => v).map(([k]) => k);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl, outputs: selected, contentMode }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to create job.");
      setNewJob(payload.job);
      setSourceUrl("");
      fetchJobs();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleDelete(e, jobId) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this job and all its files permanently?")) return;
    setDeletingId(jobId);
    try {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      setJobs(prev => prev.filter(j => j.id !== jobId));
    } catch (err) { console.error(err); }
    finally { setDeletingId(null); }
  }

  async function handleUnstick(e, jobId) {
    e.preventDefault();
    e.stopPropagation();
    setUnstickingId(jobId);
    try {
      await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unstick" }),
      });
      fetchJobs();
    } catch (err) { console.error(err); }
    finally { setUnstickingId(null); }
  }

  async function handleCleanup() {
    setCleaningUp(true);
    setCleanupResult(null);
    try {
      const res = await fetch(`/api/admin/cleanup?days=${cleanupDays}`, { method: "DELETE" });
      const data = await res.json();
      setCleanupResult(data);
      fetchJobs();
    } catch (err) {
      setCleanupResult({ error: err.message });
    } finally {
      setCleaningUp(false);
    }
  }

  const activeJobs = jobs.filter(j => j.status !== "completed" && j.status !== "failed");

  return (
    <main style={{ minHeight: "100vh" }}>
      {/* Masthead */}
      <header style={{ background: "var(--ct-blue-dark)", borderBottom: "3px solid var(--ct-red)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "rgba(255,255,255,0.6)", marginBottom: 2 }}>Camden</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 900, color: "#fff" }}>Tribune</div>
            </div>
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.2)" }} />
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, fontStyle: "italic", color: "rgba(255,255,255,0.9)" }}>Lede</div>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: 1.5, textTransform: "uppercase", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, padding: "4px 10px" }}>V1.2</div>
        </div>
      </header>
      <div style={{ height: 3, background: "var(--ct-red)", opacity: 0.15 }} />

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "56px 24px 80px" }}>

        {/* Hero */}
        <div className="fade-up" style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--ct-blue-light)", marginBottom: 20, borderBottom: "1px solid var(--ct-blue-dark)", paddingBottom: 6, display: "inline-block" }}>YouTube &amp; Vimeo → Transcript + AI Article</div>
        <h1 className="fade-up fade-up-1" style={{ fontFamily: "var(--font-display)", fontSize: "clamp(52px, 9vw, 92px)", fontWeight: 900, fontStyle: "italic", lineHeight: 0.95, letterSpacing: "-0.03em", marginBottom: 8, color: "#fff" }}>Lede.</h1>
        <p className="fade-up fade-up-1" style={{ fontFamily: "var(--font-display)", fontSize: 17, fontStyle: "italic", color: "var(--ct-red-light)", marginBottom: 24 }}>Don't bury the lede.</p>
        <p className="fade-up fade-up-2" style={{ fontSize: 16, lineHeight: 1.8, color: "var(--text-dim)", maxWidth: 520, marginBottom: 52, fontWeight: 300 }}>
          Paste a public meeting, press conference, or interview URL. Lede downloads the media, transcribes it, and generates a publication-ready article draft — automatically.
        </p>

        {/* Form */}
        <div className="fade-up fade-up-3" style={{ background: "var(--charcoal)", border: "1px solid var(--rule)", borderTop: "2px solid var(--ct-blue)", borderRadius: 16, padding: "32px", position: "relative", overflow: "hidden", marginBottom: 48 }}>
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--ct-blue-light)", marginBottom: 10 }}>Source URL</label>
            <input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://vimeo.com/... or https://youtube.com/... or direct .mp4/.m3u8 URL" required
              style={{ width: "100%", padding: "14px 18px", background: "var(--ink)", border: "1px solid var(--charcoal-light)", borderRadius: 10, color: "#fff", fontSize: 15, fontFamily: "var(--font-mono)", marginBottom: 28, outline: "none", transition: "border-color 0.2s" }}
              onFocus={e => e.target.style.borderColor = "var(--ct-blue)"}
              onBlur={e  => e.target.style.borderColor = "var(--charcoal-light)"}
            />

            <label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--ct-blue-light)", marginBottom: 14 }}>Content Mode</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 28 }}>
              {CONTENT_MODES.map(({ id, label, emoji, desc }) => (
                <button key={id} type="button" onClick={() => setContentMode(id)} style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "10px 16px",
                  background: contentMode === id ? "rgba(74,109,140,0.15)" : "var(--ink)",
                  border: contentMode === id ? "1px solid var(--ct-blue)" : "1px solid var(--charcoal-light)",
                  borderRadius: 10, cursor: "pointer", transition: "all 0.15s", minWidth: 110,
                }}>
                  <span style={{ fontSize: 16, marginBottom: 4 }}>{emoji}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: contentMode === id ? "var(--ct-blue-light)" : "var(--text-dim)", letterSpacing: 0.5, marginBottom: 2 }}>{contentMode === id ? "✓ " : ""}{label}</span>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{desc}</span>
                </button>
              ))}
            </div>

            <label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--ct-blue-light)", marginBottom: 14 }}>Output Formats</label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 32 }}>
              {OUTPUT_OPTIONS.map(({ id, label, desc }) => (
                <button key={id} type="button" onClick={() => toggle(id)} style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "12px 20px",
                  background: outputs[id] ? "rgba(74,109,140,0.15)" : "var(--ink)",
                  border: outputs[id] ? "1px solid var(--ct-blue)" : "1px solid var(--charcoal-light)",
                  borderRadius: 10, cursor: "pointer", color: outputs[id] ? "var(--ct-blue-light)" : "var(--text-dim)", transition: "all 0.15s", minWidth: 90,
                }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 500, letterSpacing: 1, marginBottom: 2 }}>{outputs[id] ? "✓ " : ""}{label}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{desc}</span>
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <button type="submit" disabled={loading} style={{
                padding: "14px 32px", background: loading ? "var(--charcoal-light)" : "var(--ct-blue-dark)",
                color: loading ? "var(--muted)" : "#fff", border: loading ? "1px solid var(--charcoal-light)" : "1px solid var(--ct-blue)",
                borderRadius: 10, fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 8,
              }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "var(--ct-blue)"; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.background = "var(--ct-blue-dark)"; }}
              >
                {loading ? <><span className="pulsing">●</span> Filing story...</> : "→ File Story"}
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, fontFamily: "var(--font-mono)" }}>Only submit content you own<br />or are authorized to process.</span>
            </div>
            {error && <div style={{ marginTop: 20, padding: "12px 16px", background: "rgba(200,80,80,0.08)", border: "1px solid rgba(200,80,80,0.3)", borderRadius: 8, color: "var(--red-err)", fontSize: 13, fontFamily: "var(--font-mono)" }}>✕ {error}</div>}
          </form>
        </div>

        {/* Story Queue */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--ct-blue-light)", borderBottom: "1px solid var(--ct-blue-dark)", paddingBottom: 4 }}>Story Queue</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {activeJobs.length > 0 && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ct-blue-light)" }}>
                  <span className="pulsing">● </span>{activeJobs.length} in progress
                </span>
              )}
              <button onClick={() => { setShowCleanup(!showCleanup); setCleanupResult(null); }} style={{
                fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
                color: "var(--muted)", background: "transparent", border: "1px solid var(--rule)",
                borderRadius: 4, padding: "4px 10px", cursor: "pointer",
              }}>🗑 Cleanup</button>
            </div>
          </div>

          {/* Cleanup panel */}
          {showCleanup && (
            <div style={{ marginBottom: 20, padding: "20px 24px", background: "var(--charcoal)", border: "1px solid var(--rule)", borderRadius: 12 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2, color: "var(--muted)", textTransform: "uppercase", marginBottom: 14 }}>Remove completed & failed jobs older than:</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {[1, 3, 7, 14, 30].map(d => (
                  <button key={d} onClick={() => setCleanupDays(d)} style={{
                    fontFamily: "var(--font-mono)", fontSize: 12, padding: "6px 14px",
                    background: cleanupDays === d ? "rgba(74,109,140,0.15)" : "var(--ink)",
                    border: cleanupDays === d ? "1px solid var(--ct-blue)" : "1px solid var(--rule)",
                    borderRadius: 6, color: cleanupDays === d ? "var(--ct-blue-light)" : "var(--muted)", cursor: "pointer",
                  }}>{d}d</button>
                ))}
                <button onClick={handleCleanup} disabled={cleaningUp} style={{
                  fontFamily: "var(--font-mono)", fontSize: 12, padding: "6px 18px",
                  background: cleaningUp ? "var(--charcoal-light)" : "rgba(200,80,80,0.1)",
                  border: "1px solid rgba(200,80,80,0.3)", borderRadius: 6,
                  color: cleaningUp ? "var(--muted)" : "var(--red-err)", cursor: cleaningUp ? "not-allowed" : "pointer",
                }}>
                  {cleaningUp ? "Cleaning..." : "Run Cleanup"}
                </button>
              </div>
              {cleanupResult && (
                <div style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 12, color: cleanupResult.error ? "var(--red-err)" : "var(--green)" }}>
                  {cleanupResult.error ? `✕ ${cleanupResult.error}` : `✓ ${cleanupResult.message} (${cleanupResult.files_deleted} file dirs removed${cleanupResult.orphans_deleted > 0 ? `, ${cleanupResult.orphans_deleted} orphans cleared` : ""})`}
                </div>
              )}
            </div>
          )}

          {jobsLoading ? (
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>LOADING...</p>
          ) : jobs.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center", border: "1px dashed var(--rule)", borderRadius: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 32, color: "var(--rule)", marginBottom: 12 }}>¶</div>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", letterSpacing: 1.5 }}>NO STORIES FILED YET</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {jobs.map(j => {
                const isActive = j.status !== "completed" && j.status !== "failed";
                const isNew = newJob?.id === j.id;
                const stuck = isStuck(j);
                const isDeleting = deletingId === j.id;
                const isUnsticking = unstickingId === j.id;
                const modeInfo = CONTENT_MODES.find(m => m.id === j.content_mode);

                return (
                  <div key={j.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 16px",
                    background: isNew ? "rgba(74,109,140,0.07)" : stuck ? "rgba(230,184,74,0.04)" : "var(--charcoal)",
                    border: stuck ? "1px solid rgba(230,184,74,0.3)" : isNew ? "1px solid var(--ct-blue-dark)" : "1px solid var(--rule)",
                    borderRadius: 12, transition: "all 0.15s",
                  }}>
                    {/* Status dot */}
                    <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: "var(--ink)", border: `1px solid ${stuck ? "#e6b84a" : statusColor(j.status)}`, display: "flex", alignItems: "center", justifyContent: "center", color: stuck ? "#e6b84a" : statusColor(j.status), fontSize: 13 }}>
                      <span className={isActive && !stuck ? "pulsing" : ""}>{stuck ? "⚠" : statusDot(j.status)}</span>
                    </div>

                    {/* Clickable info area */}
                    <a href={`/jobs/${j.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none" }}>
                      <div style={{ fontFamily: j.summary?.headline ? "var(--font-display)" : "var(--font-body)", fontStyle: j.summary?.headline ? "italic" : "normal", fontSize: 14, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>
                        {j.summary?.headline || j.title || j.source_url}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: stuck ? "#e6b84a" : "var(--muted)", letterSpacing: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {stuck ? "⚠ Stuck — " : ""}{modeInfo?.emoji} {modeInfo?.label || j.content_mode} · {j.source_type?.toUpperCase()} · {STATUS_LABELS[j.status] || j.status}
                      </div>
                    </a>

                    {/* Progress / status */}
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: stuck ? "#e6b84a" : statusColor(j.status), fontWeight: 600, marginBottom: 3 }}>
                        {j.status === "completed" ? "READY" : j.status === "failed" ? "FAILED" : `${j.progress}%`}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)" }}>{relativeTime(j.created_at)}</div>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {stuck && (
                        <button onClick={e => handleUnstick(e, j.id)} disabled={isUnsticking} title="Re-queue this stuck job" style={{
                          width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(230,184,74,0.4)",
                          background: "rgba(230,184,74,0.08)", color: "#e6b84a", cursor: "pointer",
                          fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center",
                        }}>↺</button>
                      )}
                      <button onClick={e => handleDelete(e, j.id)} disabled={isDeleting} title="Delete this job and all files" style={{
                        width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(200,80,80,0.25)",
                        background: "rgba(200,80,80,0.06)", color: "var(--red-err)", cursor: "pointer",
                        fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center",
                        opacity: isDeleting ? 0.5 : 1,
                      }}>
                        {isDeleting ? "…" : "×"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Feature strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, marginTop: 64, borderTop: "1px solid var(--rule)", paddingTop: 40 }}>
          {[
            { icon: "⬇", label: "Download",     desc: "YouTube & Vimeo" },
            { icon: "◎", label: "Transcribe",    desc: "Whisper speech-to-text" },
            { icon: "✦", label: "Article Draft", desc: "Claude Smart Mode v2" },
            { icon: "⬡", label: "SRT / VTT",     desc: "Subtitle files" },
            { icon: "⬆", label: "Publish",       desc: "Direct to WordPress" },
          ].map(({ icon, label, desc }) => (
            <div key={label} style={{ padding: "16px 0" }}>
              <div style={{ fontSize: 20, marginBottom: 8, color: "var(--ct-blue-light)" }}>{icon}</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <footer style={{ borderTop: "1px solid var(--rule)", padding: "20px 24px", maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ct-blue-light)", fontWeight: 700 }}>Lede</span>
          <span style={{ color: "var(--rule)" }}>·</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", letterSpacing: 1 }}>CAMDEN TRIBUNE</span>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", letterSpacing: 1 }}>V1.2 · EST. 2026</span>
      </footer>
    </main>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const POLL_INTERVAL = 5000;

function statusColor(s) {
  if (s === "completed") return "var(--green)";
  if (s === "failed")    return "var(--red-err)";
  return "var(--ct-blue-light)";
}

function Tag({ children, color = "var(--ct-blue-light)" }) {
  return (
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2,
      textTransform: "uppercase", color,
      borderBottom: `1px solid ${color}`, paddingBottom: 4,
      display: "inline-block", marginBottom: 16, opacity: 0.9,
    }}>{children}</div>
  );
}

function ScoreBadge({ score, max = 100, label }) {
  const pct = Math.round((score / max) * 100);
  const color = pct >= 80 ? "var(--green)" : pct >= 55 ? "#e6b84a" : "var(--red-err)";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "6px 14px",
      background: "var(--ink)", border: `1px solid ${color}`,
      borderRadius: 8, marginRight: 10, marginBottom: 8,
    }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color }}>{score}</span>
      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>/{max}<br />{label}</span>
    </div>
  );
}

function RiskBadge({ level }) {
  const map = {
    low:      { color: "var(--green)",    icon: "🟢", label: "Low Risk" },
    moderate: { color: "#e6b84a",         icon: "🟡", label: "Moderate Risk" },
    high:     { color: "var(--red-err)",  icon: "🔴", label: "High Risk" },
    unknown:  { color: "var(--muted)",    icon: "⚪", label: "Not assessed" },
  };
  const { color, icon, label } = map[level] || map.unknown;
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 12,
      color, padding: "4px 12px",
      border: `1px solid ${color}`, borderRadius: 6,
    }}>{icon} Legal: {label}</span>
  );
}

function CopyBtn({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{
      background: "transparent", border: "1px solid var(--rule)",
      color: copied ? "var(--green)" : "var(--muted)",
      borderRadius: 6, padding: "4px 12px", cursor: "pointer",
      fontSize: 12, fontFamily: "var(--font-mono)", letterSpacing: 0.5,
      transition: "all 0.15s",
    }}>
      {copied ? "✓ Copied" : label}
    </button>
  );
}

function TabBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none",
      borderBottom: active ? "2px solid var(--ct-blue)" : "2px solid transparent",
      color: active ? "var(--ct-blue-light)" : "var(--text-dim)",
      padding: "10px 18px", cursor: "pointer",
      fontFamily: "var(--font-body)", fontSize: 13, fontWeight: active ? 600 : 400,
      transition: "all 0.15s", whiteSpace: "nowrap",
    }}>{label}</button>
  );
}

function CheckRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--rule)" }}>
      <span style={{ fontSize: 13, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{label}</span>
      <span style={{ fontSize: 14, color: value ? "var(--green)" : "var(--red-err)" }}>{value ? "✓" : "✕"}</span>
    </div>
  );
}

function Pill({ children, color = "var(--ct-blue-dark)", border = "var(--ct-blue)" }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "4px 12px", marginRight: 6, marginBottom: 6,
      background: color, border: `1px solid ${border}`,
      borderRadius: 20, fontSize: 12, color: "var(--text)",
      fontFamily: "var(--font-mono)",
    }}>{children}</span>
  );
}

export default function JobPage() {
  const params = useParams();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("article");

  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${params.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setJob(data.job);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [params.id]);

  useEffect(() => { fetchJob(); }, [fetchJob]);
  useEffect(() => {
    if (!job) return;
    const done = (job.status === "completed" || job.status === "failed") && job.summary?.article_draft;
    if (done) return;
    const t = setInterval(fetchJob, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [job, fetchJob]);

  if (loading) return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "80px 24px" }}>
      <p style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", letterSpacing: 1 }}>LOADING...</p>
    </main>
  );

  if (!job) return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "80px 24px" }}>
      <a href="/" style={{ color: "var(--ct-blue-light)", fontFamily: "var(--font-mono)", fontSize: 12 }}>← LEDE</a>
      <h1 style={{ fontFamily: "var(--font-display)", marginTop: 24 }}>Job not found</h1>
    </main>
  );

  const s = job.summary;
  const isActive = job.status !== "completed" && job.status !== "failed";
  const hasSRT = Array.isArray(job.transcript?.segments_json) && job.transcript.segments_json.length > 0;
  const yoast = s?.yoast_json || {};
  const readability = s?.readability_json || {};
  const seoChecks = s?.yoast_json ? null : null;

  const tabs = [
    { id: "article",     label: s?.article_draft ? `${s.mode_emoji || "📰"} Article Draft` : "Article Draft" },
    { id: "wordpress",   label: "WordPress Package" },
    { id: "seo",         label: `SEO ${s?.seo_strength_score ? `(${s.seo_strength_score}/9)` : ""}` },
    { id: "legal",       label: `Legal ${s?.legal_risk_level ? `· ${s.legal_risk_level.toUpperCase()}` : ""}` },
    { id: "quotes",      label: `Key Quotes${s?.key_quotes_json?.length ? ` (${s.key_quotes_json.length})` : ""}` },
    { id: "transcript",  label: "Transcript" },
  ];

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px 80px" }}>

      {/* Header */}
      <header style={{
        background: "var(--ct-blue-dark)",
        borderBottom: "3px solid var(--ct-red)",
        margin: "0 -24px 40px",
        padding: "14px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <a href="/" style={{
          fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 1.5,
          color: "rgba(255,255,255,0.6)", textDecoration: "none",
        }}>← LEDE</a>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 11,
            color: statusColor(job.status), letterSpacing: 2,
          }}>
            {isActive && <span className="pulsing">● </span>}
            {job.status.toUpperCase()} {job.progress}%
          </span>
          {isActive && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: 1 }}>AUTO-REFRESH</span>}
        </div>
      </header>

      {/* Mode badge */}
      {s?.mode_label && (
        <div style={{ marginBottom: 16 }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 1.5,
            padding: "4px 12px",
            background: "var(--ct-blue-dark)", border: "1px solid var(--ct-blue)",
            borderRadius: 4, color: "var(--ct-blue-light)",
          }}>
            {s.mode_emoji} {(s.mode || "").replace(/_/g, " ").toUpperCase()}
          </span>
        </div>
      )}

      {/* Headline block */}
      <div style={{ marginBottom: 32, animation: "fadeUp 0.4s ease both" }}>
        {s?.headline ? (
          <>
            <h1 style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(24px, 4vw, 44px)",
              fontWeight: 900, lineHeight: 1.1,
              letterSpacing: "-0.02em", color: "#fff", marginBottom: 10,
            }}>{s.headline}</h1>
            {s.subtitle && (
              <p style={{ fontSize: 17, color: "var(--text-dim)", fontWeight: 300, lineHeight: 1.5, fontStyle: "italic" }}>
                {s.subtitle}
              </p>
            )}
          </>
        ) : (
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--text-dim)", fontWeight: 700 }}>
            {job.title || `Job ${job.id.slice(0, 8)}...`}
          </h1>
        )}
        {!s?.article_draft && job.status === "completed" && (
          <p style={{ marginTop: 12, fontSize: 12, color: "var(--ct-blue-light)", fontFamily: "var(--font-mono)", letterSpacing: 0.5 }}>
            ✦ Smart Mode v2 analysis in progress...
          </p>
        )}
      </div>

      {/* Score row */}
      {s && (
        <div style={{ marginBottom: 28, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {s.headline_heat_score && <ScoreBadge score={s.headline_heat_score} max={100} label="HEADLINE HEAT" />}
          {s.seo_strength_score  && <ScoreBadge score={s.seo_strength_score}  max={9}   label="SEO STRENGTH" />}
          {s.legal_risk_level    && <RiskBadge level={s.legal_risk_level} />}
          {s.headline_heat_label && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-dim)" }}>
              {s.headline_heat_label}
            </span>
          )}
        </div>
      )}

      {/* Downloads */}
      {(job.artifacts?.length > 0 || hasSRT) && (
        <div style={{ marginBottom: 32 }}>
          <Tag>Downloads</Tag>
          <div>
            {job.artifacts?.map(a => {
              const ext = a.file_name.split(".").pop().toLowerCase();
              const colors = { mp3: "#e87e4a", txt: "var(--green)", docx: "var(--ct-blue-light)" };
              const c = colors[ext] || "var(--text-dim)";
              return (
                <a key={a.id} href={`/api/jobs/${job.id}/download?path=${encodeURIComponent(a.file_path)}`} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 14px", marginRight: 8, marginBottom: 8,
                  background: "var(--ink)", border: `1px solid ${c}`,
                  borderRadius: 8, color: c, fontSize: 12,
                  fontFamily: "var(--font-mono)", textDecoration: "none",
                }}>↓ {a.file_name}</a>
              );
            })}
            {hasSRT && <>
              <a href={`/api/jobs/${job.id}/download?format=srt`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", marginRight: 8, marginBottom: 8, background: "var(--ink)", border: "1px solid var(--ct-blue-light)", borderRadius: 8, color: "var(--ct-blue-light)", fontSize: 12, fontFamily: "var(--font-mono)", textDecoration: "none" }}>↓ transcript.srt</a>
              <a href={`/api/jobs/${job.id}/download?format=vtt`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", marginRight: 8, marginBottom: 8, background: "var(--ink)", border: "1px solid var(--ct-blue-light)", borderRadius: 8, color: "var(--ct-blue-light)", fontSize: 12, fontFamily: "var(--font-mono)", textDecoration: "none" }}>↓ transcript.vtt</a>
            </>}
          </div>
        </div>
      )}

      {/* Tabs */}
      {(job.transcript || s) && (
        <>
          <div style={{ borderBottom: "1px solid var(--rule)", marginBottom: 28, display: "flex", overflowX: "auto", gap: 0 }}>
            {tabs.map(t => <TabBtn key={t.id} label={t.label} active={tab === t.id} onClick={() => setTab(t.id)} />)}
          </div>

          {/* ARTICLE DRAFT */}
          {tab === "article" && (
            <div>
              {s?.summary_text && (
                <div style={{ padding: "16px 20px", background: "rgba(74,109,140,0.06)", borderLeft: "3px solid var(--ct-blue-dark)", borderRadius: "0 10px 10px 0", marginBottom: 24 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2, color: "var(--ct-blue-light)", marginBottom: 8, textTransform: "uppercase" }}>Summary</div>
                  <p style={{ color: "var(--text-dim)", lineHeight: 1.7, margin: 0, fontSize: 15 }}>{s.summary_text}</p>
                </div>
              )}
              {s?.article_draft ? (
                <>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
                    <CopyBtn text={s.article_draft} label="Copy article" />
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 16, lineHeight: 1.9, color: "var(--text)", maxWidth: 680 }}>
                    {s.article_draft.split("\n\n").filter(Boolean).map((para, i) => (
                      <p key={i} style={{ marginBottom: 20, textAlign: "justify" }}>{para}</p>
                    ))}
                  </div>
                  {s?.photo_guidance && (
                    <div style={{ marginTop: 32, padding: "14px 18px", background: "var(--charcoal)", border: "1px solid var(--rule)", borderRadius: 10 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase" }}>📷 Photo Guidance</div>
                      <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, margin: 0 }}>{s.photo_guidance}</p>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  {job.status === "completed" ? "Smart Mode v2 analysis generating..." : "Article will appear after transcription completes."}
                </p>
              )}
            </div>
          )}

          {/* WORDPRESS PACKAGE */}
          {tab === "wordpress" && (
            <div>
              {s ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                  {/* Newspack excerpt */}
                  {s.newspack_excerpt && (
                    <div style={{ padding: "16px 20px", background: "var(--charcoal)", border: "1px solid var(--rule)", borderRadius: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2, color: "var(--ct-blue-light)", textTransform: "uppercase" }}>Newspack Excerpt</div>
                        <CopyBtn text={s.newspack_excerpt} />
                      </div>
                      <p style={{ fontSize: 14, color: "var(--text-dim)", margin: 0, lineHeight: 1.6 }}>{s.newspack_excerpt}</p>
                    </div>
                  )}

                  {/* Categories */}
                  <div style={{ padding: "16px 20px", background: "var(--charcoal)", border: "1px solid var(--rule)", borderRadius: 10 }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2, color: "var(--ct-blue-light)", marginBottom: 10, textTransform: "uppercase" }}>Categories</div>
                    <div>{(s.categories_json || []).map((c, i) => <Pill key={i}>{c}</Pill>)}</div>
                  </div>

                  {/* Tags */}
                  <div style={{ padding: "16px 20px", background: "var(--charcoal)", border: "1px solid var(--rule)", borderRadius: 10 }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2, color: "var(--ct-blue-light)", marginBottom: 10, textTransform: "uppercase" }}>Tags</div>
                    <div>{(s.tags_json || []).map((t, i) => <Pill key={i} color="var(--charcoal-mid)" border="var(--charcoal-light)">#{t}</Pill>)}</div>
                  </div>

                  {/* Readability */}
                  {readability.grade_level && (
                    <div style={{ padding: "16px 20px", background: "var(--charcoal)", border: "1px solid var(--rule)", borderRadius: 10 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2, color: "var(--ct-blue-light)", marginBottom: 12, textTransform: "uppercase" }}>Readability Audit</div>
                      <CheckRow label="Two-sentence paragraph cap" value={readability.two_sentence_cap} />
                      <CheckRow label="Active voice" value={readability.active_voice} />
                      <CheckRow label="No speculation" value={readability.no_speculation} />
                      <CheckRow label="Attribution present" value={readability.attribution_present} />
                      <div style={{ padding: "8px 0", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>Grade level</span>
                        <span style={{ fontSize: 13, color: "var(--text)", fontFamily: "var(--font-mono)" }}>{readability.grade_level}</span>
                      </div>
                      <div style={{ padding: "8px 0", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>Tone</span>
                        <span style={{ fontSize: 13, color: "var(--text)", fontFamily: "var(--font-mono)" }}>{readability.tone}</span>
                      </div>
                      {readability.pacing && (
                        <div style={{ padding: "8px 0" }}>
                          <span style={{ fontSize: 13, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>Pacing: </span>
                          <span style={{ fontSize: 13, color: "var(--text)", fontFamily: "var(--font-mono)" }}>{readability.pacing}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>WordPress package will appear after AI analysis completes.</p>
              )}
            </div>
          )}

          {/* SEO */}
          {tab === "seo" && (
            <div>
              {yoast.seo_title ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {[
                    { label: "SEO Title", value: yoast.seo_title, note: `${(yoast.seo_title || "").length}/60 chars` },
                    { label: "Slug", value: yoast.slug },
                    { label: "Meta Description", value: yoast.meta_description, note: `${(yoast.meta_description || "").length}/155 chars` },
                    { label: "Focus Keyphrase", value: yoast.focus_keyphrase },
                  ].map(({ label, value, note }) => value && (
                    <div key={label} style={{ padding: "16px 20px", background: "var(--charcoal)", border: "1px solid var(--rule)", borderRadius: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2, color: "var(--ct-blue-light)", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
                          {note && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)" }}>{note}</div>}
                        </div>
                        <CopyBtn text={value} />
                      </div>
                      <p style={{ fontSize: 14, color: "var(--text)", margin: 0, fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>{value}</p>
                    </div>
                  ))}

                  <div style={{ padding: "16px 20px", background: "var(--charcoal)", border: "1px solid var(--rule)", borderRadius: 10 }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2, color: "var(--ct-blue-light)", marginBottom: 12, textTransform: "uppercase" }}>Yoast Keyphrase Checks</div>
                    <CheckRow label="Keyphrase in first 100 words" value={yoast.keyphrase_in_intro} />
                    <CheckRow label="Keyphrase in SEO title" value={yoast.keyphrase_in_meta !== undefined ? yoast.keyphrase_in_meta : yoast.keyphrase_in_seo_title} />
                    <CheckRow label="Keyphrase in slug" value={yoast.keyphrase_in_slug} />
                  </div>

                  {s?.seo_strength_score && (
                    <div style={{ padding: "16px 20px", background: "var(--charcoal)", border: "1px solid var(--rule)", borderRadius: 10, display: "flex", alignItems: "center", gap: 16 }}>
                      <ScoreBadge score={s.seo_strength_score} max={9} label="SEO STRENGTH" />
                      <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                        {s.seo_strength_score >= 8 ? "🟢 Strong ranking potential. Ready to publish." :
                         s.seo_strength_score >= 5 ? "🟡 Minor optimization needed." :
                         "🔴 SEO rewrite recommended."}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>SEO data will appear after AI analysis completes.</p>
              )}
            </div>
          )}

          {/* LEGAL */}
          {tab === "legal" && (
            <div>
              {s?.legal_risk_level ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ padding: "20px 24px", background: "var(--charcoal)", border: "1px solid var(--rule)", borderRadius: 10 }}>
                    <RiskBadge level={s.legal_risk_level} />
                    <p style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7, margin: "12px 0 0" }}>
                      {s.legal_risk_level === "low" && "All claims appear attributed. No loaded language detected. Safe to publish."}
                      {s.legal_risk_level === "moderate" && "Some claims may need additional attribution or softer phrasing. Review flags below before publishing."}
                      {s.legal_risk_level === "high" && "Significant legal exposure detected. Do not publish as written. Address all flags below."}
                      {s.legal_risk_level === "unknown" && "Legal scan not completed."}
                    </p>
                  </div>
                  {(s.legal_flags_json || []).length > 0 && (
                    <div style={{ padding: "16px 20px", background: "rgba(200,80,80,0.06)", border: "1px solid rgba(200,80,80,0.2)", borderRadius: 10 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 2, color: "var(--red-err)", marginBottom: 12, textTransform: "uppercase" }}>Flags</div>
                      {s.legal_flags_json.map((flag, i) => (
                        <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--rule)", fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>⚠ {flag}</div>
                      ))}
                    </div>
                  )}
                  {(s.legal_flags_json || []).length === 0 && s.legal_risk_level === "low" && (
                    <div style={{ padding: "16px 20px", background: "rgba(90,170,120,0.06)", border: "1px solid rgba(90,170,120,0.2)", borderRadius: 10 }}>
                      <p style={{ fontSize: 13, color: "var(--green)", fontFamily: "var(--font-mono)", margin: 0 }}>✓ No legal flags detected. Clear to publish.</p>
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Legal scan will appear after AI analysis completes.</p>
              )}
            </div>
          )}

          {/* KEY QUOTES */}
          {tab === "quotes" && (
            <div>
              {s?.key_quotes_json?.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {s.key_quotes_json.map((quote, i) => (
                    <div key={i} style={{
                      padding: "18px 22px",
                      background: "var(--charcoal)",
                      borderLeft: "3px solid var(--green)",
                      borderRadius: "0 12px 12px 0",
                      display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16,
                    }}>
                      <p style={{ fontFamily: "var(--font-display)", fontSize: 16, lineHeight: 1.65, color: "var(--text)", fontStyle: "italic", margin: 0, flex: 1 }}>
                        "{quote}"
                      </p>
                      <CopyBtn text={`"${quote}"`} />
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Key quotes will appear after analysis completes.</p>
              )}
            </div>
          )}

          {/* TRANSCRIPT */}
          {tab === "transcript" && (
            <div>
              {job.transcript?.clean_text ? (
                <>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                    <CopyBtn text={job.transcript.clean_text} label="Copy transcript" />
                  </div>
                  <pre style={{
                    fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.9,
                    color: "var(--text-dim)", whiteSpace: "pre-wrap",
                    background: "var(--charcoal)", border: "1px solid var(--rule)",
                    borderRadius: 12, padding: 24, maxHeight: 600, overflowY: "auto",
                  }}>
                    {job.transcript.clean_text}
                  </pre>
                </>
              ) : (
                <p style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  {isActive ? "Transcript will appear once processing completes..." : "No transcript available."}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Error */}
      {job.error_message && (
        <div style={{ marginTop: 32, padding: "14px 20px", background: "rgba(200,80,80,0.06)", border: "1px solid rgba(200,80,80,0.2)", borderRadius: 10, color: "var(--red-err)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
          ✕ {job.error_message}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 48, borderTop: "1px solid var(--rule)", paddingTop: 20, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", letterSpacing: 1 }}>JOB: {job.id}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", letterSpacing: 1 }}>LEDE · CAMDEN TRIBUNE</span>
      </div>
    </main>
  );
}

# Lede

**AI-powered media intelligence for local journalism.**

Built by [Camden Tribune](https://camdentribune.com) · Powered by Claude AI

---

## Why "Lede"?

In journalism, the **lede** is the opening sentence of a news story — the most critical line, the one that must hook the reader and deliver the essential facts immediately. Getting the lede right is the first test of a good reporter.

The name fits on three levels.

**It describes what the tool produces.** Every story needs a strong opening. Lede takes raw audio — a county meeting, a press conference, an interview — and generates the headline, summary, and article draft that a journalist needs to start writing. It literally gives you your lede.

**It's a journalism insider term.** The deliberate misspelling (vs. "lead") dates back to the hot-metal typesetting era, when editors needed to distinguish the story's opening paragraph from the lead type used to print it. Any working journalist recognizes it instantly. It signals that this tool was built *for* newsrooms, not just *about* media.

**It captures the philosophy.** "Don't bury the lede" is one of the oldest rules in the profession — don't hide the most important information. The tool exists to surface what matters fast: key quotes pulled, article drafted, story ready. Nothing buried.

For Camden Tribune specifically, it reflects the broader mission — a small independent outlet using AI to punch above its weight, covering local government with the same rigor as a much larger newsroom.

> *"Don't bury the lede."*

---

## What it does

Paste a YouTube or Vimeo URL. Lede downloads the media, transcribes it using Whisper, and generates a publication-ready article draft using Claude AI — automatically.

**One URL in. Full story out.**

```
URL (YouTube / Vimeo)
  ↓
Audio extraction (yt-dlp + ffmpeg)
  ↓
Transcription (faster-whisper)
  ↓
AI analysis (Claude Sonnet)
  ↓
Headline · Summary · Article Draft · Key Quotes · SEO Description
  ↓
Downloads: MP3 · TXT · DOCX · SRT · VTT
```

---

## Built with

| Layer | Technology |
|---|---|
| Frontend / API | Next.js 14 |
| Queue | BullMQ + Redis |
| Database | PostgreSQL |
| Media download | yt-dlp + FFmpeg |
| Transcription | faster-whisper |
| AI article generation | Anthropic Claude Sonnet |
| Deployment | Docker Compose / Coolify |

---

## Stack layout

```
transcriber-v1/
├── apps/web              # Next.js frontend + API routes
├── workers/media         # Node.js — yt-dlp download + audio extraction
├── workers/transcribe    # Python — faster-whisper transcription
├── workers/llm           # Node.js — Claude AI article generation
├── packages/shared       # Shared DB + queue utilities
├── db/                   # PostgreSQL schema + auto-migration
└── docker/               # Dockerfiles + entrypoint
```

---

## Quick start

```bash
cp .env.example .env
# Edit .env — set passwords and ANTHROPIC_API_KEY
docker compose up --build
```

Open `http://localhost:3000`

---

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ANTHROPIC_API_KEY` | Claude API key (console.anthropic.com) |
| `WHISPER_MODEL` | `tiny` / `base` / `small` / `medium` |
| `WHISPER_DEVICE` | `cpu` or `cuda` |
| `STORAGE_ROOT` | File storage path (default `/data`) |
| `PUBLIC_DOWNLOAD_BASE_URL` | Base URL for download links |

---

## Coolify deployment

This project is designed for [Coolify](https://coolify.io) self-hosted deployment.

1. Push to GitHub
2. Create a **Docker Compose** resource in Coolify
3. Set environment variables (see `.env.example`)
4. Set `NEXT_PUBLIC_APP_URL` as **Buildtime + Runtime**
5. All others as **Runtime only**
6. Deploy

Persistent volumes (`app_data`, `pg_data`, `redis_data`) are configured automatically.
Database schema is created on first boot via `db/migrate.js`.

---

## Origin story

This project was conceived, designed, and deployed in a single session by
**Francisco "Cisco" Salmeron** — Publisher of [Camden Tribune](https://camdentribune.com),
Camden County, NC's independent local news outlet.

The entire build — from blank folder to working production deployment — was
pair-programmed with **Claude** (Anthropic), which wrote and debugged every line
of code across the stack: Next.js frontend, Node.js workers, Python transcription
worker, Docker infrastructure, Coolify configuration, and the LLM integration.

What started as *"how do I transcribe this Vimeo video?"* became a full
AI media intelligence platform in a few hours.

---

## Roadmap

- [ ] WordPress direct publish
- [ ] Speaker diarization
- [ ] GPU transcription support
- [ ] Auth + multi-user
- [ ] S3 / MinIO storage
- [ ] Webhook callbacks
- [ ] Translation

---

## License

MIT — use it, fork it, build on it.

---

*Lede is a Camden Tribune internal tool, open-sourced for the local journalism community.*

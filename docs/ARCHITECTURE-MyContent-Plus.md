# Architecture: MyContent+ (Minimal)

## Components

```
┌─────────────┐      ┌──────────────┐      ┌───────────────┐
│  Next.js     │─────▶│  Node.js      │─────▶│  PostgreSQL   │
│  Frontend    │◀─────│  Backend API  │◀─────│  (primary DB) │
│  (PWA)       │      │  (modules)    │      └───────────────┘
└─────────────┘      └──────┬───────┘
                             │ enqueue/status
                             ▼
                      ┌──────────────┐
                      │  Redis       │
                      │  (BullMQ)    │
                      └──────┬───────┘
                             │ jobs
              ┌──────────────┼───────────────┐
              ▼                              ▼
     ┌─────────────────┐            ┌──────────────────┐
     │ BullMQ Workers   │            │ Python/ffmpeg     │
     │ (ai, jobs, sched)│───assets──▶│ Renderer          │
     └────────┬─────────┘            └────────┬──────────┘
              │                                │
              ▼                                ▼
     ┌─────────────────┐            ┌──────────────────┐
     │  Claude API      │            │  MinIO            │
     │  (ideas/scripts)  │            │  (media assets)   │
     └─────────────────┘            └──────────────────┘
```

- **Next.js frontend**: web app + PWA shell (mobile install, offline shell, push-friendly).
- **Node.js backend**: REST/RPC API, auth, orchestration; thin — delegates heavy work to queues.
- **BullMQ workers**: consume Redis queues for AI calls, scheduling, publish jobs.
- **Python/ffmpeg renderer**: separate worker pool for video assembly (CPU-bound, isolated from Node).
- **PostgreSQL**: system of record (users, content, schedule, jobs, usage).
- **Redis**: BullMQ queue/broker + cache.
- **MinIO**: S3-compatible object storage for rendered/raw media.
- **Claude API**: idea/script/caption generation, called only from `ai` module/workers.

## Flow: idea → script → scenes → video → schedule → publish

```
User ──▶ [ai] idea prompt ──▶ Claude API ──▶ ContentIdea (DB)
                                              │
ContentIdea ──▶ [ai] script gen ──▶ Claude API ──▶ ContentScript (DB)
                                              │
ContentScript ──▶ [video] scene breakdown ──▶ BullMQ job ──▶ renderer
                                              │
Renderer (ffmpeg) ──▶ ContentAsset (MinIO + DB row)
                                              │
ContentAsset ──▶ [schedule] pick time/account ──▶ ScheduledPost (DB)
                                              │
BullMQ scheduler tick ──▶ [jobs] publish job ──▶ SocialAccount API ──▶ platform
                                              │
Job status/result ──▶ Job (DB) + ClaudeUsageLog (if AI step involved)
```

## Modules (backend)

- **auth** — user/session management, OAuth for social platforms, RBAC (workspace/agency roles).
- **social-accounts** — connect/store/refresh platform tokens; publish adapters per platform.
- **content** — ContentIdea/Script/Asset CRUD; brand profile application.
- **schedule** — calendar, queueing, approval states, ScheduledPost lifecycle.
- **jobs** — generic BullMQ job dispatch/status tracking (render, publish, AI calls).
- **ai** — Claude API client; prompt templates; caching; usage logging.
- **video** — scene planning, ffmpeg job specs, asset lifecycle, MinIO I/O.

## DB Entities (core fields only)

- **User**: id, email, role, workspace_id, created_at.
- **SocialAccount**: id, user_id/workspace_id, platform, oauth_tokens (encrypted), status.
- **BrandProfile**: id, workspace_id, voice/style params, default hashtags, logo_asset_id.
- **ContentIdea**: id, workspace_id, prompt, platform, topic, status, claude_usage_id.
- **ContentScript**: id, idea_id, body, scenes (jsonb), status.
- **ContentAsset**: id, script_id, minio_path, type (video/image/audio), duration, status.
- **ScheduledPost**: id, asset_id, social_account_id, scheduled_at, status (draft/approved/queued/published/failed).
- **Job**: id, type (render/publish/ai), ref_id, status, error, attempts, timestamps.
- **ClaudeUsageLog**: id, workspace_id, module, input_tokens, output_tokens, cost, created_at.

Relationships: `User 1—N SocialAccount`; `Workspace 1—1 BrandProfile`; `ContentIdea 1—1 ContentScript`; `ContentScript 1—N ContentAsset`; `ContentAsset 1—N ScheduledPost`; `Job` polymorphic ref to Idea/Script/Asset/Post; `ClaudeUsageLog` linked to any AI-triggering entity.

## Home-Lab Deployment

```
Internet ──▶ Traefik (TLS, routing) ──┬──▶ frontend (Next.js container)
                                       ├──▶ backend  (Node.js container)
                                       ├──▶ minio    (console + S3 API)
                                       └──▶ (internal only, no route) ─▶ postgres, redis, workers, renderer
```

- **Docker Compose** (or Swarm) stack: `frontend`, `backend`, `worker-bullmq`, `renderer-ffmpeg`, `postgres`, `redis`, `minio`, `traefik`.
- **Traefik**: single entrypoint, automatic TLS (Let's Encrypt), path/host-based routing to frontend/backend/minio console; internal services (db, redis, workers) have no public route.
- **PWA**: Next.js served with manifest + service worker so it installs on mobile home screen; talks to backend over the same Traefik-fronted HTTPS origin (no separate mobile backend needed).
- **Volumes**: named volumes for `postgres-data`, `redis-data`, `minio-data` to persist across container restarts.

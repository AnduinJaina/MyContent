# PRD: MyContent+

## Summary
- **Purpose**: An AI-native content operations platform that takes a creator/brand from idea → script → video → caption → scheduled post, then closes the loop with inbox management, repurposing, and performance analytics.
- **Users**: Independent creators, social media agencies managing multiple client accounts, and SMBs running their own marketing without a dedicated content team.
- **Differentiators**:
  - End-to-end pipeline (ideation through publishing) in one tool, not a point solution.
  - Claude-powered generation tuned for cost-efficient, on-brand output at scale.
  - Native video generation/editing (not just text/graphics) via ffmpeg/moviepy pipelines.
  - Multi-account/multi-client workspace model built in from day one (agency-ready).

## Personas
- **Creator (solo)**: Posts across 2–4 platforms, wants fast idea → script → video → post with minimal manual editing; price-sensitive, values speed and simplicity.
- **Agency**: Manages 10–50+ client accounts/brands; needs workspace isolation, brand voice presets per client, approval workflows, and rollup reporting.
- **SMB**: Non-marketer running content as a side task; wants guardrails (brand-safe defaults), a simple scheduler, and low time investment per week.

## Features

### MVP
- AI content ideation: topic/trend-based idea generation per platform and niche.
- AI scripts & captions: long-form script drafts, short captions, hashtags, CTAs.
- AI video generation: template-driven short-form video assembly (b-roll, captions, voiceover) via ffmpeg/moviepy.
- Scheduler: calendar view, multi-platform queueing, draft/approve states.
- Posting: direct publish/API integration to major social platforms.

### V1
- Unified inbox: comments/DMs across connected platforms in one view, with AI-suggested replies.
- Content repurposing: turn one long-form asset into multiple short-form clips/posts automatically.

### V2
- Analytics: cross-platform performance dashboards, per-post and per-campaign insights.
- Automation: rule-based workflows (e.g., auto-repurpose on publish, auto-reply by intent, performance-triggered reposting).

## Requirements
- **Scalability**: Stateless Next.js/Node.js services behind a load balancer; horizontally scalable workers for video rendering and Claude calls via Redis/BullMQ queues; PostgreSQL with read replicas as read volume grows.
- **Security**: OAuth-based platform integrations with encrypted token storage; per-workspace data isolation (critical for agency multi-tenant model); signed URLs for MinIO media access; audit logging for publishing/approval actions; secrets management outside application code.
- **Claude token efficiency**: Prompt caching for repeated brand/style context; reuse of system prompts across a workspace; batching of caption/hashtag generation in a single call where possible; model tiering (cheaper model for drafts/ideation, stronger model for final scripts) to control cost at scale.

## Architecture
- **Frontend/API**: Next.js (SSR + API routes) for web app and BFF layer.
- **Backend services**: Node.js workers/services for orchestration, platform integrations, and business logic.
- **Database**: PostgreSQL for core relational data (users, workspaces, content, schedules, analytics).
- **Queue/cache**: Redis + BullMQ for async jobs — video rendering, Claude generation requests, scheduled publishing, repurposing pipelines.
- **Object storage**: MinIO for raw/rendered media assets (video, audio, images), served via signed URLs.
- **Media processing**: ffmpeg/moviepy workers for video assembly, clipping, and repurposing, run as background jobs off the queue.
- **AI layer**: Claude API for ideation, scripting, captioning, and reply suggestions, with prompt caching and model tiering applied at the orchestration layer.

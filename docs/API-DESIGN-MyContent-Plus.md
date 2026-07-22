# API Design: MyContent+ (Minimal)

## Module Structure

```
src/
  modules/
    auth/            signup, login, session, me
    users/           user + workspace profile
    social-accounts/ connect/list/delete platform accounts
    content/         ideas, scripts, assets
    schedule/        scheduled posts CRUD
    jobs/            job status/listing
    ai/              ClaudeService, prompt templates
    video/           scene planning, render job specs
  workers/
    renderVideo.worker.ts
    publishPost.worker.ts
  queues/
    render.queue.ts
    publish.queue.ts
```

## TS Models (core entities)

```ts
type Role = 'owner' | 'admin' | 'member';

interface User {
  id: string;
  workspaceId: string;
  email: string;
  role: Role;
  createdAt: string;
}

interface BrandProfile {
  id: string;
  workspaceId: string;
  voice: string;
  defaultHashtags: string[];
  logoAssetId?: string;
}

type Platform = 'twitter' | 'facebook' | 'instagram' | 'linkedin' | 'youtube' | 'reddit';

interface SocialAccount {
  id: string;
  workspaceId: string;
  platform: Platform;
  externalAccountId: string;
  accessToken: string;   // encrypted at rest
  refreshToken?: string; // encrypted at rest
  status: 'active' | 'expired' | 'revoked';
}

interface ContentIdea {
  id: string;
  workspaceId: string;
  prompt: string;
  platform: Platform;
  topic: string;
  status: 'draft' | 'accepted' | 'discarded';
  claudeUsageId?: string;
}

interface Scene {
  index: number;
  text: string;
  durationSec: number;
  visualHint?: string;
}

interface ContentScript {
  id: string;
  ideaId: string;
  body: string;
  scenes: Scene[];
  status: 'draft' | 'final';
}

type AssetType = 'video' | 'image' | 'audio';

interface ContentAsset {
  id: string;
  scriptId: string;
  minioPath: string;
  type: AssetType;
  durationSec?: number;
  status: 'pending' | 'ready' | 'failed';
}

type PostStatus = 'draft' | 'approved' | 'queued' | 'published' | 'failed';

interface ScheduledPost {
  id: string;
  assetId: string;
  socialAccountId: string;
  caption: string;
  scheduledAt: string;
  status: PostStatus;
}

type JobType = 'render' | 'publish' | 'ai';
type JobStatus = 'waiting' | 'active' | 'completed' | 'failed';

interface Job {
  id: string;
  type: JobType;
  refId: string; // ContentAsset.id | ScheduledPost.id | ContentIdea.id
  status: JobStatus;
  error?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

interface ClaudeUsageLog {
  id: string;
  workspaceId: string;
  module: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}
```

## Endpoints

**auth**
- `POST /auth/signup` — { email, password } → { user, token }
- `POST /auth/login` — { email, password } → { user, token }
- `GET  /auth/me` — → { user }

**social-accounts**
- `POST   /social-accounts/connect` — { platform, oauthCode } → { socialAccount }
- `GET    /social-accounts` — → { socialAccounts: SocialAccount[] }
- `DELETE /social-accounts/:id` — → { ok: true }

**content**
- `POST /content/ideas` — { topic, platform } → { idea: ContentIdea } (calls ai module)
- `GET  /content/ideas` — → { ideas: ContentIdea[] }
- `POST /content/ideas/:id/script` — → { script: ContentScript } (calls ai module)
- `GET  /content/scripts/:id` — → { script: ContentScript }
- `POST /content/scripts/:id/assets` — → { job: Job } (enqueues renderVideo)
- `GET  /content/assets/:id` — → { asset: ContentAsset }

**schedule**
- `POST   /schedule` — { assetId, socialAccountId, caption, scheduledAt } → { post: ScheduledPost }
- `GET    /schedule` — ?from&to → { posts: ScheduledPost[] }
- `GET    /schedule/:id` — → { post: ScheduledPost }
- `PATCH  /schedule/:id` — { caption?, scheduledAt?, status? } → { post: ScheduledPost }
- `DELETE /schedule/:id` — → { ok: true }

**jobs**
- `GET /jobs` — ?type&status → { jobs: Job[] }
- `GET /jobs/:id` — → { job: Job }

## ClaudeService (short prompts, JSON output, caching)

```ts
import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();
const cache = new Map<string, unknown>(); // swap for Redis in prod

function cacheKey(prompt: string, schema: string) {
  return createHash('sha256').update(prompt + schema).digest('hex');
}

export async function generateJSON<T>(prompt: string, schemaHint: string): Promise<T> {
  const key = cacheKey(prompt, schemaHint);
  if (cache.has(key)) return cache.get(key) as T;

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 512,
    system: `Respond with JSON only, matching: ${schemaHint}. No prose.`,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '{}';
  const parsed = JSON.parse(text) as T;
  cache.set(key, parsed);
  return parsed;
}

// usage
interface IdeaResult { title: string; hook: string; hashtags: string[] }
const idea = await generateJSON<IdeaResult>(
  `3-word topic: "meal prep"; platform: instagram`,
  '{ "title": string, "hook": string, "hashtags": string[] }'
);
```

## Workers

```ts
// queues/render.queue.ts
import { Queue } from 'bullmq';
export const renderQueue = new Queue('render', { connection: { host: 'redis' } });

// queues/publish.queue.ts
import { Queue } from 'bullmq';
export const publishQueue = new Queue('publish', { connection: { host: 'redis' } });
```

```ts
// workers/renderVideo.worker.ts
import { Worker } from 'bullmq';
import { spawn } from 'child_process';

new Worker('render', async (job) => {
  const { scriptId, scenes } = job.data;
  await runFfmpegPipeline(scenes); // shells out to ffmpeg/moviepy
  return { assetPath: `renders/${scriptId}.mp4` };
}, { connection: { host: 'redis' } });

function runFfmpegPipeline(scenes: unknown[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn('python3', ['render.py', JSON.stringify(scenes)]);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}
```

```ts
// workers/publishPost.worker.ts
import { Worker } from 'bullmq';
import { publishToPlatform } from '../modules/social-accounts/publish';

new Worker('publish', async (job) => {
  const { postId, socialAccountId, assetPath, caption } = job.data;
  await publishToPlatform(socialAccountId, { assetPath, caption });
  return { postId, status: 'published' };
}, { connection: { host: 'redis' } });
```

# Unified Posting System: MyContent+ (Minimal)

## Core Interface

```ts
interface MediaUploadResult {
  mediaId: string;
  raw?: unknown;
}

interface PublishInput {
  socialAccountId: string;
  mediaId?: string;
  caption: string;
  extra?: Record<string, unknown>; // platform-specific (board for Pinterest, subreddit for Reddit, etc.)
}

interface PublishResult {
  externalPostId: string;
  url?: string;
}

interface PlatformAdapter {
  uploadMedia(account: SocialAccount, filePath: string): Promise<MediaUploadResult>;
  publishPost(account: SocialAccount, input: PublishInput): Promise<PublishResult>;
  refreshToken(account: SocialAccount): Promise<TokenRefreshResult>;
}

interface TokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string; // ISO
}
```

## Unified Error Format

```ts
type PostingErrorCode =
  | 'AUTH_EXPIRED' | 'RATE_LIMITED' | 'MEDIA_REJECTED'
  | 'PLATFORM_UNAVAILABLE' | 'INVALID_INPUT' | 'UNKNOWN';

class PostingError extends Error {
  constructor(
    public code: PostingErrorCode,
    public platform: Platform,
    public retryable: boolean,
    public retryAfterMs?: number,
    cause?: unknown,
  ) { super(`[${platform}] ${code}`); this.cause = cause; }
}

function normalizeError(platform: Platform, err: unknown): PostingError {
  const status = (err as any)?.response?.status;
  if (status === 401) return new PostingError('AUTH_EXPIRED', platform, true);
  if (status === 429) {
    const retryAfterMs = Number((err as any)?.response?.headers?.['retry-after'] ?? 30) * 1000;
    return new PostingError('RATE_LIMITED', platform, true, retryAfterMs);
  }
  if (status && status >= 500) return new PostingError('PLATFORM_UNAVAILABLE', platform, true);
  if (status && status >= 400) return new PostingError('MEDIA_REJECTED', platform, false, undefined, err);
  return new PostingError('UNKNOWN', platform, false, undefined, err);
}
```

## Adapter Templates (one per platform)

Each adapter implements `PlatformAdapter`; only the platform-specific call differs. Skeleton shown once, then per-platform notes.

```ts
abstract class BaseAdapter implements PlatformAdapter {
  abstract uploadMedia(account: SocialAccount, filePath: string): Promise<MediaUploadResult>;
  abstract publishPost(account: SocialAccount, input: PublishInput): Promise<PublishResult>;
  abstract refreshToken(account: SocialAccount): Promise<TokenRefreshResult>;

  protected async guarded<T>(platform: Platform, fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (err) { throw normalizeError(platform, err); }
  }
}
```

**YouTube** (`googleapis`)
```ts
class YouTubeAdapter extends BaseAdapter {
  uploadMedia(account, filePath) {
    return this.guarded('youtube', async () => {
      const res = await youtube.videos.insert({
        auth: authFor(account), part: ['snippet,status'],
        requestBody: { snippet: { title: 'Untitled' }, status: { privacyStatus: 'public' } },
        media: { body: fs.createReadStream(filePath) },
      });
      return { mediaId: res.data.id! };
    });
  }
  publishPost(account, input) {
    return this.guarded('youtube', async () => ({ externalPostId: input.mediaId! }));
  }
  refreshToken(account) { return refreshGoogleToken(account); }
}
```

**TikTok** (Content Posting API)
```ts
class TikTokAdapter extends BaseAdapter {
  uploadMedia(account, filePath) {
    return this.guarded('tiktok', async () => {
      const { data } = await tiktokClient.post('/v2/post/publish/video/init/', videoInitBody(filePath), authHeaders(account));
      await uploadChunks(data.upload_url, filePath);
      return { mediaId: data.publish_id };
    });
  }
  publishPost(account, input) {
    return this.guarded('tiktok', async () => {
      const { data } = await tiktokClient.get(`/v2/post/publish/status/fetch/?id=${input.mediaId}`, authHeaders(account));
      return { externalPostId: data.publish_id };
    });
  }
  refreshToken(account) { return refreshOAuth2(account, TIKTOK_TOKEN_URL); }
}
```

**Instagram** (`facebook-nodejs-business-sdk`, Graph API)
```ts
class InstagramAdapter extends BaseAdapter {
  uploadMedia(account, filePath) {
    return this.guarded('instagram', async () => {
      const ig = new bizSdk.IGUser(account.externalAccountId);
      const container = await ig.createMedia({ video_url: toPublicUrl(filePath), media_type: 'REELS' });
      return { mediaId: container.id };
    });
  }
  publishPost(account, input) {
    return this.guarded('instagram', async () => {
      const ig = new bizSdk.IGUser(account.externalAccountId);
      const res = await ig.createPublish({ creation_id: input.mediaId, caption: input.caption });
      return { externalPostId: res.id };
    });
  }
  refreshToken(account) { return refreshMetaLongLivedToken(account); }
}
```

**Facebook** (`facebook-nodejs-business-sdk`)
```ts
class FacebookAdapter extends BaseAdapter {
  uploadMedia(account, filePath) {
    return this.guarded('facebook', async () => {
      const page = new bizSdk.Page(account.externalAccountId);
      const video = await page.createVideo({ file_url: toPublicUrl(filePath), published: false });
      return { mediaId: video.id };
    });
  }
  publishPost(account, input) {
    return this.guarded('facebook', async () => {
      const page = new bizSdk.Page(account.externalAccountId);
      const post = await page.createFeed({ description: input.caption, attached_media: [{ media_fbid: input.mediaId }] });
      return { externalPostId: post.id };
    });
  }
  refreshToken(account) { return refreshMetaLongLivedToken(account); }
}
```

**LinkedIn** (`linkedin-api` or official Marketing API)
```ts
class LinkedInAdapter extends BaseAdapter {
  uploadMedia(account, filePath) {
    return this.guarded('linkedin', async () => {
      const asset = await linkedinClient.registerUpload(account.externalAccountId);
      await linkedinClient.uploadBytes(asset.uploadUrl, filePath);
      return { mediaId: asset.asset };
    });
  }
  publishPost(account, input) {
    return this.guarded('linkedin', async () => {
      const res = await linkedinClient.createShare(account.externalAccountId, input.caption, input.mediaId);
      return { externalPostId: res.id };
    });
  }
  refreshToken(account) { return refreshOAuth2(account, LINKEDIN_TOKEN_URL); }
}
```

**X / Twitter** (`twitter-api-v2`)
```ts
class XAdapter extends BaseAdapter {
  uploadMedia(account, filePath) {
    return this.guarded('twitter', async () => {
      const client = clientFor(account);
      const mediaId = await client.v1.uploadMedia(filePath);
      return { mediaId };
    });
  }
  publishPost(account, input) {
    return this.guarded('twitter', async () => {
      const client = clientFor(account);
      const { data } = await client.v2.tweet({ text: input.caption, media: input.mediaId ? { media_ids: [input.mediaId] } : undefined });
      return { externalPostId: data.id };
    });
  }
  refreshToken(account) { return refreshOAuth2(account, TWITTER_TOKEN_URL); }
}
```

**Reddit** (`praw`, via internal Python microservice call)
```ts
class RedditAdapter extends BaseAdapter {
  uploadMedia(account, filePath) {
    return this.guarded('reddit', async () => {
      const res = await redditServiceClient.post('/upload', { filePath, account: account.externalAccountId });
      return { mediaId: res.data.mediaId };
    });
  }
  publishPost(account, input) {
    return this.guarded('reddit', async () => {
      const res = await redditServiceClient.post('/submit', {
        account: account.externalAccountId, subreddit: input.extra?.subreddit, title: input.caption, mediaId: input.mediaId,
      });
      return { externalPostId: res.data.id };
    });
  }
  refreshToken(account) { return refreshOAuth2(account, REDDIT_TOKEN_URL); }
}
```

**Pinterest** (Pinterest API v5)
```ts
class PinterestAdapter extends BaseAdapter {
  uploadMedia(account, filePath) {
    return this.guarded('pinterest', async () => ({ mediaId: toPublicUrl(filePath) })); // media passed as media_source on pin create
  }
  publishPost(account, input) {
    return this.guarded('pinterest', async () => {
      const { data } = await pinterestClient.post('/v5/pins', {
        board_id: input.extra?.boardId, description: input.caption,
        media_source: { source_type: 'image_url', url: input.mediaId },
      }, authHeaders(account));
      return { externalPostId: data.id };
    });
  }
  refreshToken(account) { return refreshOAuth2(account, PINTEREST_TOKEN_URL); }
}
```

## Adapter Registry

```ts
const adapters: Record<Platform, PlatformAdapter> = {
  youtube: new YouTubeAdapter(),
  tiktok: new TikTokAdapter(),
  instagram: new InstagramAdapter(),
  facebook: new FacebookAdapter(),
  linkedin: new LinkedInAdapter(),
  twitter: new XAdapter(),
  reddit: new RedditAdapter(),
  pinterest: new PinterestAdapter(),
};

function adapterFor(platform: Platform): PlatformAdapter {
  return adapters[platform];
}
```

## OAuth Storage

```ts
interface SocialAccount {
  id: string;
  workspaceId: string;
  platform: Platform;
  externalAccountId: string;
  accessToken: string;   // encrypted at rest (AES-256, KMS-managed key)
  refreshToken?: string; // encrypted at rest
  expiresAt: string;     // ISO; checked before every publish
  status: 'active' | 'expired' | 'revoked';
}

async function ensureFreshToken(account: SocialAccount): Promise<SocialAccount> {
  if (new Date(account.expiresAt) > new Date(Date.now() + 60_000)) return account;
  const { accessToken, refreshToken, expiresAt } = await adapterFor(account.platform).refreshToken(account);
  return db.socialAccounts.update(account.id, { accessToken, refreshToken, expiresAt, status: 'active' });
}
```

## Scheduler: publishPost Queue + Worker

```ts
// queues/publish.queue.ts
import { Queue } from 'bullmq';
export const publishQueue = new Queue('publish', { connection: { host: 'redis' } });

// enqueue at scheduledAt
await publishQueue.add('publish-post', { postId, socialAccountId, assetPath, caption, extra },
  { delay: Math.max(0, new Date(scheduledAt).getTime() - Date.now()) });
```

```ts
// workers/publishPost.worker.ts
import { Worker } from 'bullmq';

new Worker('publish', async (job) => {
  const { postId, socialAccountId, assetPath, caption, extra } = job.data;
  const account = await ensureFreshToken(await db.socialAccounts.get(socialAccountId));
  const adapter = adapterFor(account.platform);

  const media = await adapter.uploadMedia(account, assetPath);
  const result = await adapter.publishPost(account, { socialAccountId, mediaId: media.mediaId, caption, extra });

  await db.scheduledPosts.update(postId, { status: 'published', externalPostId: result.externalPostId });
  return result;
}, {
  connection: { host: 'redis' },
  concurrency: 5,
});
```

## Rate-Limit Retry Policy

```ts
new Worker('publish', handler, {
  connection: { host: 'redis' },
  settings: { backoffStrategy: (attemptsMade, _type, err) => {
    if (err instanceof PostingError && err.retryable) {
      return err.code === 'RATE_LIMITED' ? (err.retryAfterMs ?? 30_000) : 2 ** attemptsMade * 1000;
    }
    return -1; // do not retry
  }},
});

// on enqueue
await publishQueue.add('publish-post', data, {
  attempts: 5,
  backoff: { type: 'custom' },
});
```

On non-retryable `PostingError` (`MEDIA_REJECTED`, `INVALID_INPUT`), mark `ScheduledPost.status = 'failed'` immediately and surface `error` on the `Job` record for manual review.

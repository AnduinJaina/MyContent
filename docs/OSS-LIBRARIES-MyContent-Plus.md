# Open-Source Libraries: MyContent+ (Minimal, Free)

| Library | Why chosen | Install |
|---|---|---|
| [BullMQ](https://github.com/taskforcesh/bullmq) | Redis-backed job queue for AI, render, and publish jobs; battle-tested, TS-native. | `npm i bullmq` |
| [twitter-api-v2](https://github.com/PLhery/node-twitter-api-v2) | Full v2 API + media upload in one typed Node client. | `npm i twitter-api-v2` |
| [facebook-nodejs-business-sdk](https://github.com/facebook/facebook-nodejs-business-sdk) | Official Meta SDK — covers Facebook Page + Instagram Graph publishing. | `npm i facebook-nodejs-business-sdk` |
| [linkedin-api](https://github.com/tomquirk/linkedin-api) | Unofficial but simplest path to LinkedIn posting where official API access is gated. | `pip install linkedin-api` |
| [googleapis](https://github.com/googleapis/google-api-nodejs-client) (youtube) | Official Google client; covers YouTube Data API v3 upload/metadata. | `npm i googleapis` |
| [praw](https://github.com/praw-dev/praw) | De-facto standard Python Reddit wrapper, handles OAuth/rate limits. | `pip install praw` |
| [ffmpeg](https://github.com/FFmpeg/FFmpeg) | Core transcode/render engine; everything else (moviepy, fluent-ffmpeg) wraps it. | `apt install ffmpeg` (or Docker base image) |
| [moviepy](https://github.com/Zulko/moviepy) | Pythonic scene assembly (clips, overlays, captions) on top of ffmpeg. | `pip install moviepy` |
| [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) | Node-side ffmpeg control when render step needs to stay in the Node process. | `npm i fluent-ffmpeg` |
| [NextAuth.js](https://github.com/nextauthjs/next-auth) | Drop-in auth for Next.js; built-in OAuth providers reused for social-account login. | `npm i next-auth` |
| [minio-js](https://github.com/minio/minio-js) | Official S3-compatible client for MinIO asset upload/signed URLs. | `npm i minio` |
| [spaCy](https://github.com/explosion/spaCy) | Fast NLP for keyword/entity extraction to seed AI prompts and hashtags. | `pip install spacy` |
| [NLTK](https://github.com/nltk/nltk) | Lightweight text utilities (tokenize, stopwords) for caption/script post-processing. | `pip install nltk` |
| [Bottleneck](https://github.com/SGrondin/bottleneck) | Rate limiter/throttler for Node — protects Claude/social API calls from bursts. | `npm i bottleneck` |

## Minimal Integration Snippets

**BullMQ** — enqueue a render job
```js
import { Queue } from 'bullmq';
const renderQueue = new Queue('render', { connection: { host: 'redis' } });
await renderQueue.add('render-video', { scriptId, scenes });
```

**twitter-api-v2** — post with media
```js
import { TwitterApi } from 'twitter-api-v2';
const client = new TwitterApi(userTokens);
const mediaId = await client.v1.uploadMedia('./out.mp4');
await client.v2.tweet({ text: caption, media: { media_ids: [mediaId] } });
```

**facebook-nodejs-business-sdk** — publish to IG
```js
const bizSdk = require('facebook-nodejs-business-sdk');
bizSdk.FacebookAdsApi.init(accessToken);
const ig = new bizSdk.IGUser(igUserId);
await ig.createMedia({ image_url: assetUrl, caption });
```

**linkedin-api** — post text update
```python
from linkedin_api import Linkedin
api = Linkedin(username, password)
api.submit_share(caption)
```

**googleapis (YouTube)** — upload video
```js
const { google } = require('googleapis');
const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
await youtube.videos.insert({
  part: ['snippet,status'],
  requestBody: { snippet: { title, description }, status: { privacyStatus: 'public' } },
  media: { body: fs.createReadStream('./out.mp4') },
});
```

**praw** — post to subreddit
```python
import praw
reddit = praw.Reddit(client_id=CID, client_secret=SECRET, username=U, password=P, user_agent='mycontent+')
reddit.subreddit('test').submit(title, url=video_url)
```

**ffmpeg** — burn captions
```bash
ffmpeg -i in.mp4 -vf subtitles=captions.srt -c:a copy out.mp4
```

**moviepy** — assemble scenes
```python
from moviepy.editor import VideoFileClip, concatenate_videoclips
clips = [VideoFileClip(f"scene_{i}.mp4") for i in range(len(scenes))]
concatenate_videoclips(clips).write_videofile("out.mp4")
```

**fluent-ffmpeg** — transcode in Node
```js
const ffmpeg = require('fluent-ffmpeg');
ffmpeg('in.mp4').outputOptions('-vf', 'scale=1080:1920').save('out.mp4');
```

**NextAuth.js** — provider config
```ts
// app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth';
import TwitterProvider from 'next-auth/providers/twitter';
export const { GET, POST } = NextAuth({ providers: [TwitterProvider({ clientId, clientSecret })] });
```

**minio-js** — upload asset
```js
const { Client } = require('minio');
const minio = new Client({ endPoint: 'minio', port: 9000, useSSL: false, accessKey, secretKey });
await minio.fPutObject('assets', `renders/${id}.mp4`, './out.mp4');
```

**spaCy** — extract keywords
```python
import spacy
nlp = spacy.load("en_core_web_sm")
doc = nlp(script_text)
keywords = [t.text for t in doc if t.pos_ in ("NOUN", "PROPN")]
```

**NLTK** — tokenize caption
```python
from nltk.tokenize import word_tokenize
tokens = word_tokenize(caption_text)
```

**Bottleneck** — throttle Claude calls
```js
const Bottleneck = require('bottleneck');
const limiter = new Bottleneck({ minTime: 200, maxConcurrent: 5 });
await limiter.schedule(() => claude.messages.create({ ... }));
```

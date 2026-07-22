# Script → Video Pipeline: MyContent+ (Minimal)

## Pipeline Overview

```
ContentScript ─▶ [scene breakdown: Claude] ─▶ Scene[] (JSON)
                                                  │
                                                  ▼
                              renderVideo job (BullMQ) ──▶ Python renderer
                                                  │
                     load scenes → backgrounds (stock/AI B-roll) → overlays
                     → subtitles → transitions → concat → music → MP4
                                                  │
                                                  ▼
                                    upload MP4 → MinIO ──▶ ContentAsset
```

## 1. Scene Breakdown Prompt

**Input:** `scriptText`

```
System: Output strict JSON only. Match schema. No prose.
User:
script: {{scriptText}}
Task: break into scenes for video render.
Schema: {
  "scenes": [
    {
      "id": number,
      "duration": number,        // seconds
      "narration": string,       // voiceover/subtitle source text
      "subtitle": string,        // on-screen text (may be shorter than narration)
      "bgType": "stock" | "color" | "ai_broll",
      "bgDesc": string           // search term (stock) or generation prompt (ai_broll) or hex (color)
    }
  ]
}
```

## 2. Renderer (moviepy)

Steps: load scenes → backgrounds → overlays → subtitles → transitions → concat → music → MP4.

```python
# render.py
import sys, json
from moviepy.editor import (
    VideoFileClip, ImageClip, ColorClip, TextClip,
    CompositeVideoClip, concatenate_videoclips, AudioFileClip, vfx
)

def build_background(scene):
    if scene["bgType"] == "color":
        return ColorClip(size=(1080, 1920), color=hex_to_rgb(scene["bgDesc"])).set_duration(scene["duration"])
    if scene["bgType"] == "stock":
        return VideoFileClip(resolve_stock_path(scene["bgDesc"])).subclip(0, scene["duration"])
    if scene["bgType"] == "ai_broll":
        return VideoFileClip(scene["_aiBrollPath"]).subclip(0, scene["duration"])  # pre-fetched
    raise ValueError(scene["bgType"])

def build_scene_clip(scene):
    bg = build_background(scene).resize((1080, 1920))
    subtitle = (TextClip(scene["subtitle"], fontsize=64, color="white", method="caption", size=(960, None))
                .set_position(("center", "bottom"))
                .set_duration(scene["duration"]))
    return CompositeVideoClip([bg, subtitle]).fadein(0.2).fadeout(0.2)  # simple transition

def render(scenes, music_path, out_path):
    clips = [build_scene_clip(s) for s in scenes]
    final = concatenate_videoclips(clips, method="compose")
    if music_path:
        music = AudioFileClip(music_path).volumex(0.2).set_duration(final.duration)
        final = final.set_audio(music)
    final.write_videofile(out_path, fps=30, codec="libx264", audio_codec="aac")

if __name__ == "__main__":
    scenes = json.loads(sys.argv[1])
    render(scenes, music_path=sys.argv[2] if len(sys.argv) > 2 else None, out_path=sys.argv[3])
```

**fluent-ffmpeg alternative** (Node-side, no Python dependency) — use when scenes are simple concat + subtitle burn without complex compositing:

```js
const ffmpeg = require('fluent-ffmpeg');

function renderScenes(sceneFiles, subtitlesPath, musicPath, outPath) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg();
    sceneFiles.forEach((f) => cmd.input(f));
    cmd
      .complexFilter([`concat=n=${sceneFiles.length}:v=1:a=0[v]`])
      .outputOptions(['-map', '[v]', '-vf', `subtitles=${subtitlesPath}`])
      .input(musicPath).outputOptions(['-shortest'])
      .output(outPath)
      .on('end', resolve).on('error', reject)
      .run();
  });
}
```

## 3. Optional AI B-roll (SDXL / ComfyUI)

For scenes with `bgType: "ai_broll"`, generate the background before rendering:

```python
import requests

def generate_broll(prompt: str, out_path: str, comfyui_url="http://comfyui:8188"):
    workflow = load_workflow_template()  # ComfyUI API-format JSON with prompt node
    workflow["nodes"]["prompt"]["text"] = prompt
    res = requests.post(f"{comfyui_url}/prompt", json={"prompt": workflow})
    prompt_id = res.json()["prompt_id"]
    result = poll_for_output(comfyui_url, prompt_id)  # poll /history/{id}
    save_output(result, out_path)
    return out_path
```

- Pre-fetch all `ai_broll` scenes' assets before calling `render()`; attach the resulting path as `scene["_aiBrollPath"]`.
- Keep this step optional/behind a flag — falls back to `stock` backgrounds if ComfyUI is unavailable.

## 4. Worker: renderVideo Queue + Handler

```ts
// queues/render.queue.ts
import { Queue } from 'bullmq';
export const renderQueue = new Queue('render', { connection: { host: 'redis' } });

// enqueue
await renderQueue.add('render-video', { scriptId, scenes, musicPath });
```

```ts
// workers/renderVideo.worker.ts
import { Worker } from 'bullmq';
import { spawn } from 'child_process';
import { uploadToMinio } from '../modules/video/storage';

new Worker('render', async (job) => {
  const { scriptId, scenes, musicPath } = job.data;

  const scenesWithBroll = await resolveAiBroll(scenes); // generate_broll for ai_broll scenes
  const localOutPath = `/tmp/${scriptId}.mp4`;

  await runRenderer(scenesWithBroll, musicPath, localOutPath);

  const minioPath = await uploadToMinio(localOutPath, `renders/${scriptId}.mp4`);
  return { assetPath: minioPath };
}, { connection: { host: 'redis' } });

function runRenderer(scenes: unknown[], musicPath: string | undefined, outPath: string) {
  return new Promise<void>((resolve, reject) => {
    const args = [JSON.stringify(scenes), musicPath ?? '', outPath];
    const p = spawn('python3', ['render.py', ...args]);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`render exit ${code}`))));
  });
}
```

## 5. Storage: Upload MP4 to MinIO

```ts
// modules/video/storage.ts
import { Client } from 'minio';

const minio = new Client({
  endPoint: process.env.MINIO_HOST!,
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
});

export async function uploadToMinio(localPath: string, objectName: string): Promise<string> {
  await minio.fPutObject('assets', objectName, localPath, { 'Content-Type': 'video/mp4' });
  return objectName; // stored on ContentAsset.minioPath; signed URL generated on read
}
```

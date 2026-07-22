# Prompt Templates: MyContent+ (Strict JSON)

Shared rules for every template:
- System line: `Output strict JSON only. No prose, no markdown, no code fences. Match the schema exactly.`
- Keep wording minimal. Reject extra keys. All strings concise.

---

## 1. Ideas

**Input:** `niche, audience, platform, style, brandVoice`

**Prompt**
```
System: Output strict JSON only. Match schema. No prose.
User:
niche: {{niche}}
audience: {{audience}}
platform: {{platform}}
style: {{style}}
brandVoice: {{brandVoice}}
Task: 10 content ideas.
Schema: { "ideas": [ { "title": string, "hook": string, "angle": string } ] }  // length 10
```

---

## 2. Scripts

**Input:** `ideaText, platform, style`

**Prompt**
```
System: Output strict JSON only. Match schema. No prose.
User:
idea: {{ideaText}}
platform: {{platform}}
style: {{style}}
Task: short-form video script.
Schema: {
  "hook": string,
  "beats": [ { "t": number, "line": string, "visual": string } ],
  "cta": string,
  "timestamps": [ { "label": string, "start": number, "end": number } ]
}
```

---

## 3. Captions

**Input:** `scriptText, platform`

**Prompt**
```
System: Output strict JSON only. Match schema. No prose.
User:
script: {{scriptText}}
platform: {{platform}}
Task: 3 caption variants + hashtags.
Schema: {
  "captions": [ string, string, string ],
  "hashtags": [ string ]   // 5-10, no '#'
}
```

---

## 4. Carousels

**Input:** `topic`

**Prompt**
```
System: Output strict JSON only. Match schema. No prose.
User:
topic: {{topic}}
Task: carousel slides (5-8).
Schema: { "slides": [ { "n": number, "headline": string, "body": string } ] }  // length 5-8
```

---

## 5. Repurposing

**Input:** `longFormText, mode` where `mode ∈ {short_ideas, carousel, posts}`

**Prompt**
```
System: Output strict JSON only. Match schema for the given mode. No prose.
User:
source: {{longFormText}}
mode: {{mode}}
Schemas:
  short_ideas: { "clips": [ { "title": string, "startHint": string, "hook": string } ] }  // 3-6
  carousel:    { "slides": [ { "n": number, "headline": string, "body": string } ] }        // 5-8
  posts:       { "posts": [ { "text": string, "hashtags": [ string ] } ] }                   // 3-5
```

---

## 6. BrandVoice

**Input:** `sampleText` (or brand description)

**Prompt**
```
System: Output strict JSON only. Match schema. No prose.
User:
samples: {{sampleText}}
Task: extract brand voice profile.
Schema: {
  "tone": [ string ],        // e.g. ["warm","direct"]
  "vocab": { "prefer": [ string ], "avoid": [ string ] },
  "pacing": "fast" | "medium" | "slow",
  "sentenceLength": "short" | "mixed" | "long"
}
```

---

## 7. Style + Platform Dictionaries

Injected as context to constrain generation. Static JSON, not model-generated.

**Style dictionary**
```json
{
  "educational": { "guidance": "teach one idea, plain language", "emoji": "minimal" },
  "entertaining": { "guidance": "high energy, pattern interrupts", "emoji": "frequent" },
  "inspirational": { "guidance": "story + takeaway", "emoji": "light" },
  "promotional": { "guidance": "benefit-led, single CTA", "emoji": "light" }
}
```

**Platform dictionary**
```json
{
  "tiktok":    { "maxSec": 60,  "aspect": "9:16", "captionMax": 150, "hashtagMax": 5 },
  "reels":     { "maxSec": 90,  "aspect": "9:16", "captionMax": 200, "hashtagMax": 10 },
  "shorts":    { "maxSec": 60,  "aspect": "9:16", "captionMax": 100, "hashtagMax": 5 },
  "youtube":   { "maxSec": 600, "aspect": "16:9", "captionMax": 5000, "hashtagMax": 15 },
  "instagram": { "maxSec": 90,  "aspect": "4:5",  "captionMax": 2200, "hashtagMax": 30 },
  "linkedin":  { "maxSec": 600, "aspect": "1:1",  "captionMax": 3000, "hashtagMax": 5 },
  "twitter":   { "maxSec": 140, "aspect": "16:9", "captionMax": 280,  "hashtagMax": 3 }
}
```

**Usage:** merge the relevant `style` and `platform` entries into the system context before the task prompt so the model respects limits and tone without extra wording.

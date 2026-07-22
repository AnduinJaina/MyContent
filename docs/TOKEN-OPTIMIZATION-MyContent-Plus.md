# Claude Token Optimization: MyContent+ (Minimal)

## Call Classification & Strategy

| Call Type | Example | Value | Strategy |
|-----------|---------|-------|----------|
| **High-value** | ideas, scripts | 1 idea = 10 posts, 1 script = N repurposes | Cache aggressively; prompt cache; batch requests |
| **Medium** | captions, CTAs | Re-done per asset but fast model ok | Cache if brand+asset combo repeats; cheaper model (Haiku) |
| **Avoidable** | hashtags, keywords | Can use spaCy/NLTK locally with ~90% quality | Never call Claude; use local NLP |

**Rule**: Only call Claude for generative, high-ROI steps. Handle structural/filtering work locally.

---

## Caching Strategy

```ts
interface CachedPrompt {
  hash: string;           // SHA256(template + sorted(vars))
  templateName: string;   // ideas, scripts, captions, etc.
  inputVars: Record<string, unknown>;
  outputJSON: unknown;
  createdAt: string;      // ISO
  ttlDays: number;        // 30 for ideas, 7 for captions, 1 for volatile
}
```

**Lookup before calling Claude:**
1. Hash the prompt (template + input vars).
2. Query `CachedPrompt` by hash.
3. If hit and not expired, return cached output.
4. If miss, call Claude, store result.

---

## Hashing

```ts
import { createHash } from 'crypto';

function hashPrompt(templateName: string, vars: Record<string, unknown>): string {
  const sorted = Object.keys(vars)
    .sort()
    .map(k => `${k}=${JSON.stringify(vars[k])}`)
    .join('|');
  const combined = `${templateName}::${sorted}`;
  return createHash('sha256').update(combined).digest('hex');
}

// usage
const hash = hashPrompt('ideas', { niche: 'fitness', platform: 'tiktok', style: 'educational' });
```

---

## Deduplication & Cache Lookup

```ts
async function callClaudeWithCache<T>(
  templateName: string,
  vars: Record<string, unknown>,
  callFn: () => Promise<{ text: string; inputTokens: number; outputTokens: number }>,
  ttlDays: number = 30,
): Promise<T> {
  const hash = hashPrompt(templateName, vars);

  // check cache
  const cached = await db.cachedPrompts.findOne({ hash, templateName });
  if (cached && new Date(cached.createdAt).getTime() + ttlDays * 86400000 > Date.now()) {
    console.log(`[cache hit] ${templateName}/${hash}`);
    return cached.outputJSON as T;
  }

  // call Claude
  const res = await callFn();
  const outputJSON = JSON.parse(res.text);

  // store
  await db.cachedPrompts.upsert({ hash, templateName, inputVars: vars, outputJSON, createdAt: new Date().toISOString(), ttlDays });
  await logUsage(templateName, res.inputTokens, res.outputTokens);

  return outputJSON as T;
}
```

---

## ClaudeUsageLog: Track Tokens & Cost

```ts
interface ClaudeUsageLog {
  id: string;
  workspaceId: string;
  module: string;          // 'ai', 'content', 'video'
  templateName: string;    // 'ideas', 'scripts', 'captions'
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

const PRICING = { inputPer1M: 3, outputPer1M: 15 }; // adjust for claude-sonnet-5 rates

async function logUsage(templateName: string, inputTokens: number, outputTokens: number, workspaceId: string) {
  const costUsd = (inputTokens / 1_000_000) * PRICING.inputPer1M + (outputTokens / 1_000_000) * PRICING.outputPer1M;
  await db.claudeUsageLogs.insert({
    workspaceId, templateName, inputTokens, outputTokens, costUsd, createdAt: new Date().toISOString(),
  });
}

// dashboard query (daily cost per workspace)
async function getCostPerDay(workspaceId: string) {
  return db.claudeUsageLogs.raw(`
    SELECT DATE(createdAt) as day, SUM(costUsd) as total FROM claudeUsageLogs
    WHERE workspaceId = $1 GROUP BY DATE(createdAt) ORDER BY day DESC
  `, [workspaceId]);
}
```

---

## Local NLP: Replace Claude for Keywords & Hashtags

**Never call Claude for hashtag generation.** Use spaCy + domain lexicon.

```ts
import spacy from 'spacy-nodejs'; // or exec Python subprocess
import { stopwords } from 'nltk';

async function extractKeywords(text: string, topN: number = 10): Promise<string[]> {
  const nlp = spacy.load('en_core_web_sm');
  const doc = nlp(text);
  const keywords = doc
    .filter(t => t.pos_ === 'NOUN' || t.pos_ === 'PROPN' || t.pos_ === 'ADJ')
    .filter(t => !stopwords.has(t.text.toLowerCase()))
    .slice(0, topN)
    .map(t => t.text);
  return keywords;
}

async function generateHashtags(scriptText: string, brandHashtags: string[] = []): Promise<string[]> {
  const keywords = await extractKeywords(scriptText, 5);
  const tags = keywords.map(k => k.replace(/\s+/g, '').toLowerCase()).slice(0, 10);
  return [...new Set([...brandHashtags, ...tags])]; // dedupe
}

// usage: never calls Claude
const tags = await generateHashtags(script.body, brand.defaultHashtags);
// ~zero cost, <100ms latency
```

---

## Chunking: Break Long Text, Summarize Locally

For long-form content (articles, transcripts), don't pass the whole thing to Claude for ideas/repurposing.

```ts
function chunkText(text: string, maxTokensPerChunk: number = 2000): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let chunk = '';
  for (const word of words) {
    const line = chunk ? `${chunk} ${word}` : word;
    if (line.split(/\s+/).length * 1.3 > maxTokensPerChunk) { // rough: 1 token ≈ 1.3 words
      chunks.push(chunk);
      chunk = word;
    } else {
      chunk = line;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

async function summarizeChunks(chunks: string[]): Promise<string> {
  // use cheaper model (Haiku) for summarization
  const summaries = await Promise.all(chunks.map(c =>
    callClaudeWithCache<{ summary: string }>('summarize-chunk', { chunk: c }, () =>
      claudeCall({ model: 'claude-haiku-4-5-20251001', prompt: `Summarize in 1-2 sentences: ${c}` }), 1
    )
  ));
  return summaries.map(s => s.summary).join(' ');
}

// then pass summary (not full text) to ideas/scripts generation
const summary = await summarizeChunks(chunkText(longArticle));
const ideas = await callClaudeWithCache<IdeasResult>('ideas', { summary, platform: 'tiktok' }, ...);
```

---

## BrandVoice as Reusable Context

Store brand voice once, inject into every prompt. Cached JSON, no generation cost.

```ts
interface BrandVoice {
  tone: string[];        // ["warm", "direct"]
  vocab: { prefer: string[]; avoid: string[] };
  pacing: string;        // "fast" | "medium" | "slow"
  examples: string[];    // 2–3 sample posts
}

// stored in BrandProfile once
const brand = await db.brandProfiles.findOne({ workspaceId });

// inject into prompts as static context (prompt caching)
const systemPrompt = `
You are a content creator with this voice:
Tone: ${brand.voice.tone.join(', ')}
Vocab prefer: ${brand.voice.vocab.prefer.join(', ')}
Vocab avoid: ${brand.voice.vocab.avoid.join(', ')}
Pacing: ${brand.voice.pacing}
Examples: ${brand.voice.examples.join('\n')}
${PLATFORM_CONTEXT[platform]}
${STYLE_CONTEXT[style]}
Respond with JSON only.
`;

// prompt caching: this static context is cached once per workspace/day
const res = await anthropic.messages.create({
  model: 'claude-sonnet-5',
  max_tokens: 512,
  system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: userPrompt }],
});
```

---

## Token Budget & Alerts

Track workspace consumption to alert on overages.

```ts
async function checkTokenBudget(workspaceId: string, monthlyBudgetUsd: number = 100) {
  const thisMonth = new Date();
  thisMonth.setDate(1);
  const cost = await db.claudeUsageLogs.raw(
    `SELECT SUM(costUsd) as total FROM claudeUsageLogs WHERE workspaceId = $1 AND createdAt >= $2`,
    [workspaceId, thisMonth.toISOString()]
  );
  const spent = cost[0]?.total ?? 0;
  if (spent > monthlyBudgetUsd * 0.8) {
    await notifyAdmins(workspaceId, `Claude spend ${spent.toFixed(2)}/${monthlyBudgetUsd} reached 80%`);
  }
}
```

---

## Optimization Checklist

- [ ] Cache all `ideas` and `scripts` calls (high TTL, highest reuse).
- [ ] Cache `captions` per asset type (shorter TTL, medium reuse).
- [ ] Never call Claude for hashtags; use spaCy + local lexicon.
- [ ] Chunk long-form text; summarize with Haiku before ideas/repurposing.
- [ ] Store BrandVoice once; use prompt caching on every call.
- [ ] Use `claude-haiku-4-5-20251001` for low-creativity tasks (summaries, QA, extraction).
- [ ] Use `claude-sonnet-5` for high-creativity tasks (ideas, scripts, repurposing).
- [ ] Log all calls to `ClaudeUsageLog` for cost tracking and dashboard.
- [ ] Set monthly per-workspace budgets and alert at 80%.
- [ ] Review cache hit rates weekly; adjust TTLs based on usage patterns.

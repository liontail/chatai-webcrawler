# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A web crawler + RAG chatbot system for the Thai Ragnarok Online Classic forum at `ro-prt.in.th/forum/`. It harvests forum topics/posts, embeds them into a Qdrant vector database, and serves an AI chatbot via a REST API + web UI.

## Commands

```bash
# Start all services (FlareSolverr, Qdrant, chatbot server)
bash start.sh

# Run the full BFS crawler (starts from config.startUrl)
npm start                    # node index.js

# Crawl only specific known topic IDs (targeted approach)
node crawl-topics.js

# Add a single topic — tries FlareSolverr first, falls back to piped HTML
node ingest-one.js "https://ro-prt.in.th/forum/index.php?app=forums&module=forums&controller=topic&id=XXXXX"
cat fragment.html | node ingest-one.js "https://..."

# Embed all crawled JSON files into Qdrant
npm run ingest               # node ai/ingest.js
node ai/ingest.js --fresh    # wipe collection and re-ingest

# Start chatbot API + web UI
npm run chat                 # node ai/server.js  →  http://localhost:3200
```

## Code Style

CommonJS only (`require` / `module.exports`) — no ESM. No semicolons. Space before `(` in function declarations:

```js
async function name () { ... }
const fn = function () { ... }
```

Lodash must be destructured at import: `const { get, map, compact } = require('lodash')`

## Architecture

Three layers that execute sequentially:

```
Crawler → output/ (JSON files) → AI ingest → Qdrant → Chatbot API
```

### Crawler layer (`index.js` + `crawler/`)

- `router.js` — classifies a URL into one of 6 types: `topic`, `forum`, `forums_list`, `member`, `stream`, `search_results`. The site uses IPS4 query-string URLs (`?app=forums&module=forums&controller=topic&id=123`), not only friendly paths.
- `queue.js` — dedup queue with URL normalisation. Strips session params, sorts query params for stable canonical form.
- `fetcher.js` — wraps FlareSolverr (Docker on `:8191`) via Node's native `http` module (not axios — Node 22 incompatibility). Uses `require('p-queue').default` for concurrency.
- `parser.js` — cheerio + link extraction restricted to `ro-prt.in.th`.
- `extractor/topicExtractor.js` — **critical selectors**: posts are `div[data-commentid]` (IPS4 uses divs, not articles). Body is `[data-role="commentContent"], .cPost_contentWrap, .ipsComment_content, .ipsType_richText`.
- `filter.js` — gates what gets saved. Rejects off-topic content (non-Classic) and outdated Event Quest posts.
- `index.js` feed loop: only enqueues `topic` and `search_results` URL types to prevent queue bloat. Uses 200ms yield + `onIdle()` to avoid busy-looping the event loop.

### Storage layer (`storage/writer.js`)

Writes to `output/{type}/` as individual JSON files. Posts go under `output/posts/{topicId}/{postId}.json`. Each type directory has an `index.json` manifest.

### AI layer (`ai/`)

- `embedder.js` — `prepareDocuments(record)` formats each record type into searchable text (`[TOPIC] ...`, `[POST in topic X] ...`). Posts carry `images: []` in metadata so the chatbot can return them.
- `vectorStore.js` — Qdrant wrapper. IDs are stable hashes of metadata so re-ingestion is idempotent (upsert).
- `retriever.js` — **multi-query retrieval**: expands the user's question into 2 alternative phrasings via GPT, embeds all 3 in one batch, searches Qdrant in parallel, merges + deduplicates by text, returns top-K. This is critical for questions that span multiple document sections.
- `chatbot.js` — keeps last 6 history messages, temperature 0.3, answers only from retrieved context. System prompt instructs GPT not to use training knowledge — only the provided context. A full RO abbreviation reference block (e.g. NCT = Nightmare Clock Tower) is injected into the system prompt. How-to questions must include every step/item/NPC/coordinate without summarizing. `IMAGE_SCORE_THRESHOLD = 0.45` — only chunks with score ≥ 0.45 contribute images. Images capped at 6; non-GIFs sorted before GIFs.
- `server.js` — Express on `process.env.PORT` (default `3200`). Serves static files from `ai/public/` at `/`. API: `POST /chat`, `GET /health`, `GET /stats`.
- `public/index.html` — chat UI. localStorage persists `{role, content, images, sources}` per message so images/sources restore on reload. Markdown-rendered `<a>` links get `target="_blank" rel="noopener noreferrer"` injected post-render (applies to inline links in AI answer text, not just source cards).

## Key Configuration

**`config.js`** (crawler):
- `concurrency: 2`, `rateLimit: 2000ms`, `requestTimeout: 60000ms`
- `filters.classic.strictTitle: false` — saves topics even if title doesn't contain Classic keywords

**`ai/config.js`**:
- Embedding model: `text-embedding-3-small` (1536 dims)
- Chat model: `gpt-4o-mini`
- `retrieval.topK: 12`, `retrieval.scoreThreshold: 0.2`

**`.env`**:
```
BEARER_TOKEN=sk-...           # OpenAI API key (named BEARER_TOKEN not OPENAI_API_KEY)
OPENAI_BASE_URL=https://api.openai.com/v1
QDRANT_URL=http://localhost:6333
PORT=3200
```

## Infrastructure Dependencies

Both must be running before crawling or serving the chatbot:

| Service | How to start | Port |
|---|---|---|
| FlareSolverr | `docker run -d --name flaresolverr -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest` | 8191 |
| Qdrant | `docker run -d --name qdrant -p 6333:6333 -v $(pwd)/qdrant_storage:/qdrant/storage qdrant/qdrant` | 6333 |

## Targeted Crawling (Preferred Approach)

The full BFS crawler (`index.js`) can queue thousands of URLs via Cloudflare-protected pages. The preferred approach is targeted:

1. Provide HTML of search result pages manually
2. Extract topic IDs from them
3. Hardcode IDs in `crawl-topics.js` and run it
4. Run `node ai/ingest.js` to embed

For individual topics that Cloudflare blocks, use `ingest-one.js` with piped HTML (full page or just the `<div class="cPost_contentWrap">` fragment).

## Common Pitfalls

- `var history = []` in browser global scope shadows `window.history` — use `chatHistory` instead
- `require('p-queue').default` — p-queue v6 is ESM-first; `.default` is required for CommonJS
- FlareSolverr takes 12–20s per request; `requestTimeout` must be ≥ 60000ms
- Qdrant payload path is `payload` directly (not `payload.metadata`) when mapping search results in `retriever.js`
- The `POST /chat` body field is `query` (not `message`)
- `chatHistory` in localStorage only stores `{role, content}` by default — must also store `images` and `sources` for assistant messages or they disappear on reload

#!/usr/bin/env node
/**
 * ingest-one.js — Add a single topic/post to the knowledge base.
 *
 * Usage:
 *   node ingest-one.js <url>                  # fetch via FlareSolverr
 *   node ingest-one.js <url> < fragment.html  # use piped HTML (full page OR post div fragment)
 *   cat fragment.html | node ingest-one.js <url>
 *
 * If fetch fails AND no HTML is piped → exits with instructions.
 * The URL is always used for metadata (topic ID, slug, etc.).
 */

require('dotenv').config()

const cheerio = require('cheerio')
const { compact, map } = require('lodash')
const fetcher = require('./crawler/fetcher')
const parser = require('./crawler/parser')
const extractor = require('./crawler/extractor')
const writer = require('./storage/writer')
const { prepareDocuments, embed } = require('./ai/embedder')
const { createVectorStore } = require('./ai/vectorStore')
const logger = require('./logger')

// ── Helpers ────────────────────────────────────────────────────────────────

function topicIdFromUrl (url) {
  try {
    const u = new URL(url)
    return u.searchParams.get('id') || ''
  } catch (e) {
    return ''
  }
}

function commentIdFromUrl (url) {
  try {
    const hash = new URL(url).hash // e.g. #comment-758246
    const m = hash.match(/comment-(\d+)/)
    return m ? m[1] : ''
  } catch (e) {
    return ''
  }
}

function slugFromUrl (url) {
  try {
    const u = new URL(url)
    const last = u.pathname.replace(/\/$/, '').split('/').pop()
    return last.replace(/^\d+-/, '') || 'index-php'
  } catch (e) {
    return 'index-php'
  }
}

function cleanTopicUrl (url) {
  try {
    const u = new URL(url)
    // Keep only the canonical params
    const id = u.searchParams.get('id')
    if (!id) return url
    return `https://ro-prt.in.th/forum/index.php?app=forums&module=forums&controller=topic&id=${id}`
  } catch (e) {
    return url
  }
}

function isFullPage (html) {
  const prefix = html.trimStart().slice(0, 200).toLowerCase()
  return prefix.includes('<!doctype') || prefix.includes('<html')
}

// ── Image extractor (mirrors topicExtractor.extractImages) ─────────────────

const EMOJI_PATTERNS = ['/emoticons/', '/emoji/', 'emojione', '.emojione']
const TRACKER_PATTERNS = ['//www.google-analytics', '//www.facebook.com/tr']

function extractImagesFromEl ($root, baseUrl) {
  const imgEls = $root.find('img').toArray()

  const images = compact(map(imgEls, function (imgEl) {
    const src = (imgEl.attribs && imgEl.attribs.src) || ''
    if (!src || src.startsWith('data:')) return null

    const width  = (imgEl.attribs && imgEl.attribs.width)  || ''
    const height = (imgEl.attribs && imgEl.attribs.height) || ''
    if (width === '1' || height === '1') return null

    const cls = (imgEl.attribs && imgEl.attribs.class) || ''
    if (cls.includes('ipsEmoji')) return null

    const srcLower = src.toLowerCase()
    if (EMOJI_PATTERNS.some(function (p) { return srcLower.includes(p) })) return null
    if (TRACKER_PATTERNS.some(function (p) { return srcLower.includes(p) })) return null

    let resolvedUrl = src
    try {
      resolvedUrl = new URL(src, baseUrl).href
    } catch (e) {
      return null
    }

    const urlLower = resolvedUrl.toLowerCase()
    const isGif = urlLower.endsWith('.gif')
      || urlLower.includes('?mime=gif')
      || /[^a-z]gif([?#]|$)/.test(urlLower)

    const alt = (imgEl.attribs && imgEl.attribs.alt) || ''
    return { url: resolvedUrl, isGif, alt }
  }))

  const seen = new Set()
  return compact(images.filter(function (img) {
    if (seen.has(img.url)) return false
    seen.add(img.url)
    return true
  }))
}

// ── Fragment extractor — called when input is a post div, not a full page ──

function extractFromFragment (html, url) {
  const $ = cheerio.load(html)
  const topicId  = topicIdFromUrl(url)
  const commentId = commentIdFromUrl(url) || topicId + '_post'
  const cleanUrl  = cleanTopicUrl(url)
  const crawledAt = new Date().toISOString()

  // Find the content wrapper — could be the root or nested inside
  const bodyEl = $('[data-role="commentContent"]').first().length
    ? $('[data-role="commentContent"]').first()
    : $('.cPost_contentWrap').first().length
      ? $('.cPost_contentWrap').first()
      : $.root()

  const bodyText = bodyEl.text().trim()
  const bodyHtml = bodyEl.html() || ''

  // Try to extract a title from heading tags inside the content
  let title = ''
  const heading = bodyEl.find('h1, h2, h3, strong').first()
  if (heading.length) title = heading.text().trim()
  if (!title) title = `Topic ${topicId}`

  const images = extractImagesFromEl(bodyEl, url)

  const topicRecord = {
    type: 'topic',
    id: topicId,
    slug: slugFromUrl(url),
    url: cleanUrl,
    forumId: null,
    title,
    author: { id: '', username: '', profileUrl: '' },
    isPinned: false,
    isLocked: false,
    tags: [],
    stats: { views: 0, replies: 0 },
    pageCount: 1,
    firstPostDate: null,
    lastPostDate: null,
    crawledAt,
  }

  const postRecord = {
    type: 'post',
    id: commentId,
    topicId,
    forumId: null,
    url: url,
    author: { id: '', username: '', profileUrl: '', avatar: null },
    body: bodyHtml,
    bodyText,
    images,
    postedAt: null,
    editedAt: null,
    reactionCount: 0,
    isFirstPost: true,
    crawledAt,
  }

  return [topicRecord, postRecord]
}

// ── Full-page extractor — uses existing pipeline ───────────────────────────

function extractFromFullPage (html, url) {
  const { $ } = parser.parse(html, url)
  const topicId = topicIdFromUrl(url)
  const classification = { type: 'topic', id: topicId }
  const data = extractor.extract($, cleanTopicUrl(url), classification)
  if (!data) return null
  return Array.isArray(data) ? data : [data]
}

// ── Read stdin if data is piped ─────────────────────────────────────────────

function readStdin () {
  return new Promise (function (resolve) {
    if (process.stdin.isTTY) {
      resolve(null)
      return
    }
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', function (chunk) { data += chunk })
    process.stdin.on('end', function () { resolve(data.trim() || null) })
  })
}

// ── Ingest records into Qdrant ─────────────────────────────────────────────

async function ingestRecords (records) {
  const vectorStore = createVectorStore()
  await vectorStore.ensureCollection()

  const allDocs = []
  for (const record of records) {
    const docs = prepareDocuments(record)
    if (docs && docs.length > 0) allDocs.push(...docs)
  }

  if (allDocs.length === 0) {
    logger.warn('No documents to ingest (empty text bodies?)')
    return 0
  }

  const texts = allDocs.map(function (d) { return d.text })
  const embeddings = await embed(texts)

  const zipped = allDocs.map(function (doc, i) {
    return { ...doc, embedding: embeddings[i] }
  })

  await vectorStore.upsert(zipped)
  return allDocs.length
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main () {
  const url = process.argv[2]
  if (!url) {
    console.error('Usage: node ingest-one.js <url> [< fragment.html]')
    process.exit(1)
  }

  await writer.ensureOutputDirs()

  // 1. Read piped HTML (if any)
  const pipedHtml = await readStdin()

  let html = null
  let source = ''

  if (pipedHtml) {
    // HTML was piped — use it directly
    html = pipedHtml
    source = 'piped HTML'
    logger.info(`Using piped HTML input (${html.length} chars)`)
  } else {
    // Try FlareSolverr fetch
    logger.info(`Fetching ${url} via FlareSolverr...`)
    try {
      html = await fetcher.fetch(url)
      source = 'FlareSolverr'
      logger.info(`Fetched ${html.length} chars via FlareSolverr`)
    } catch (err) {
      logger.warn(`Fetch failed: ${err.message}`)
      console.error('\n❌ Fetch failed and no HTML was piped.')
      console.error('   Pipe the page HTML via stdin:')
      console.error('   cat topic.html | node ingest-one.js "' + url + '"\n')
      process.exit(1)
    }
  }

  // 2. Determine extraction mode
  let records
  if (isFullPage(html)) {
    logger.info(`Extracting from full page (source: ${source})`)
    records = extractFromFullPage(html, url)
    if (!records || records.length === 0) {
      logger.error('Full-page extractor returned nothing — is the HTML a valid topic page?')
      process.exit(1)
    }
  } else {
    logger.info(`Extracting from HTML fragment (source: ${source})`)
    records = extractFromFragment(html, url)
  }

  const topicId = topicIdFromUrl(url)
  const topicRecord = records.find(function (r) { return r.type === 'topic' })
  const postRecords = records.filter(function (r) { return r.type === 'post' })

  logger.info(`Extracted: 1 topic + ${postRecords.length} posts | images: ${
    postRecords.reduce(function (sum, p) { return sum + (p.images || []).length }, 0)
  }`)
  if (topicRecord) logger.info(`Title: "${topicRecord.title}"`)

  // 3. Save to disk
  if (topicRecord) {
    await writer.write(topicRecord)
    await writer.appendManifest('topic', {
      id: topicRecord.id,
      slug: topicRecord.slug,
      url: cleanTopicUrl(url)
    })
  }
  for (const post of postRecords) {
    await writer.write(post)
  }
  logger.info('Saved records to output/')

  // 4. Embed + upsert to Qdrant
  logger.info('Embedding and upserting to Qdrant...')
  const count = await ingestRecords(records)
  logger.info(`✅ Done — upserted ${count} document(s) into Qdrant for topic ${topicId}`)
}

main().catch(function (err) {
  logger.error(`Fatal: ${err.message}`)
  process.exit(1)
})

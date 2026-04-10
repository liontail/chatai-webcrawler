const { OpenAI } = require('openai')
const { chunk, map, compact, get } = require('lodash')
const aiConfig = require('./config')

const openai = new OpenAI({
  apiKey: aiConfig.openai.apiKey,
  baseURL: aiConfig.openai.baseURL
})

/**
 * Splits text into overlapping chunks.
 * Strategy:
 *  1. Split by double newline (paragraphs)
 *  2. If paragraph > maxChars, split by sentence delimiter
 *  3. Accumulate up to maxChars, then start new chunk with `overlap` trailing chars
 *
 * @param {string} text
 * @param {number} maxChars
 * @param {number} overlap
 * @returns {string[]}
 */
function chunkText (text, maxChars = 2048, overlap = 256) {
  if (!text || !text.trim()) return []

  // Step 1: split by paragraphs
  const paragraphs = text.split(/\n\n+/)

  // Step 2: further split oversized paragraphs by sentence boundary
  const segments = []
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      segments.push(para)
    } else {
      // Split on sentence-ending punctuation followed by space
      const sentences = para.split(/(?<=[.?!])\s+/)
      for (const sentence of sentences) {
        segments.push(sentence)
      }
    }
  }

  // Step 3: accumulate segments into chunks
  const chunks = []
  let current = ''

  for (const seg of segments) {
    const trimmed = seg.trim()
    if (!trimmed) continue

    const candidate = current ? current + '\n\n' + trimmed : trimmed

    if (candidate.length <= maxChars) {
      current = candidate
    } else {
      if (current) {
        chunks.push(current)
        // Carry forward the tail of the previous chunk as overlap
        const tail = current.slice(-overlap)
        current = tail ? tail + '\n\n' + trimmed : trimmed
      } else {
        // Single segment larger than maxChars — hard split it
        let pos = 0
        while (pos < trimmed.length) {
          chunks.push(trimmed.slice(pos, pos + maxChars))
          pos += maxChars - overlap
        }
        current = ''
      }
    }
  }

  if (current.trim()) chunks.push(current.trim())

  return compact(chunks.map(c => c.trim()))
}

/**
 * Takes a crawled JSON record and returns an array of { text, metadata } objects.
 *
 * @param {object} record
 * @returns {{ text: string, metadata: object }[]}
 */
function prepareDocuments (record) {
  const type = get(record, 'type', '')
  const docs = []

  if (type === 'topic') {
    const id = get(record, 'id', '')
    const title = get(record, 'title', '')
    const tags = get(record, 'tags', [])
    const tagsStr = Array.isArray(tags) ? tags.join(', ') : String(tags || '')
    const views = get(record, 'stats.views', 0)
    const replies = get(record, 'stats.replies', 0)

    const text = `[TOPIC] ${title}\n\n${tagsStr}\n\nViews: ${views} Replies: ${replies}`.trim()
    if (!text.trim()) return []

    docs.push({
      text,
      metadata: {
        type,
        id,
        topicId: id,
        title,
        url: get(record, 'url', ''),
        forumId: get(record, 'forumId', ''),
        tags,
        crawledAt: get(record, 'crawledAt', '')
      }
    })
  } else if (type === 'post') {
    const id = get(record, 'id', '')
    const topicId = get(record, 'topicId', '')
    const bodyText = get(record, 'bodyText', '') || ''
    const url = get(record, 'url', '')
    const forumId = get(record, 'forumId', '')
    const postIndex = get(record, 'postIndex', 0)
    const authorUsername = get(record, 'author.username', '')
    const postedAt = get(record, 'postedAt', '')

    if (!bodyText.trim()) return []

    const baseMetadata = {
      type,
      id,
      topicId,
      forumId,
      postIndex,
      url,
      'author.username': authorUsername,
      postedAt,
      images: get(record, 'images', [])
    }

    if (bodyText.length > 2048) {
      const bodyChunks = chunkText(bodyText, 2048, 256)
      for (const bodyChunk of bodyChunks) {
        const text = `[POST in topic ${topicId}]\n\n${bodyChunk}`.trim()
        if (!text.trim()) continue
        docs.push({ text, metadata: { ...baseMetadata } })
      }
    } else {
      const text = `[POST in topic ${topicId}]\n\n${bodyText}`.trim()
      docs.push({ text, metadata: baseMetadata })
    }
  } else if (type === 'forum') {
    const id = get(record, 'id', '')
    const title = get(record, 'title', '') || get(record, 'slug', '')
    const description = get(record, 'description', '') || ''

    const text = `[FORUM] ${title}\n\n${description}`.trim()
    if (!text.trim()) return []

    docs.push({
      text,
      metadata: {
        type,
        id,
        title,
        url: get(record, 'url', '')
      }
    })
  } else if (type === 'member') {
    const id = get(record, 'id', '')
    const username = get(record, 'username', '')
    const group = get(record, 'group', '')
    const posts = get(record, 'stats.posts', 0)
    const bio = get(record, 'bio', '') || ''

    const text = `[MEMBER] ${username} | Group: ${group} | Posts: ${posts}\n\n${bio}`.trim()
    if (!text.trim()) return []

    docs.push({
      text,
      metadata: {
        type,
        id,
        username,
        url: get(record, 'url', '')
      }
    })
  }

  return docs
}

/**
 * Calls OpenAI embeddings API in batches.
 * Retries once after 10s on 429 rate limit errors.
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embed (texts) {
  if (!texts || !texts.length) return []

  const batches = chunk(texts, aiConfig.ingestion.batchSize)
  const allEmbeddings = []

  for (const batch of batches) {
    let response
    try {
      response = await openai.embeddings.create({
        model: aiConfig.openai.embeddingModel,
        input: batch
      })
    } catch (err) {
      if (err.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 10000))
        response = await openai.embeddings.create({
          model: aiConfig.openai.embeddingModel,
          input: batch
        })
      } else {
        throw err
      }
    }

    // OpenAI returns embeddings sorted by index — preserve that order
    const sorted = response.data.slice().sort((a, b) => a.index - b.index)
    for (const item of sorted) {
      allEmbeddings.push(item.embedding)
    }
  }

  return allEmbeddings
}

module.exports = {
  chunkText,
  prepareDocuments,
  embed
}

const { OpenAI } = require('openai')
const { get, map, uniqBy, orderBy } = require('lodash')
const aiConfig = require('./config')
const { createRetriever } = require('./retriever')
const logger = require('../logger')

// Collect images only from high-relevance chunks (score >= 0.45)
// to avoid returning unrelated images from marginally-matching chunks.
const IMAGE_SCORE_THRESHOLD = 0.45

const collectImages = function (chunks) {
  const allImages = []
  chunks.forEach(function (chunk) {
    const score = get(chunk, 'score', 0)
    if (score < IMAGE_SCORE_THRESHOLD) return // skip low-relevance chunks
    const images = get(chunk, 'metadata.images', [])
    const topicId = get(chunk, 'metadata.topicId', null)
    const topicUrl = get(chunk, 'metadata.url', null)
    images.forEach(function (img) {
      allImages.push({
        url: img.url,
        isGif: img.isGif,
        alt: img.alt || '',
        score,
        topicId,
        sourceUrl: topicUrl
      })
    })
  })
  const deduped = uniqBy(allImages, 'url')
  // Sort: non-GIFs first (isGif=false sorts before true), then by score descending
  const sorted = orderBy(deduped, ['isGif', 'score'], ['asc', 'desc'])
  return sorted.slice(0, 6)
}

const createChatbot = function () {
  const openai = new OpenAI({
    apiKey: aiConfig.openai.apiKey,
    baseURL: aiConfig.openai.baseURL
  })
  const retriever = createRetriever()

  const chat = async function (query, history = []) {
    const chunks = await retriever.retrieve(query)

    const contextString = chunks
      .map(function (chunk) {
        const score = chunk.score.toFixed(2)
        const url = get(chunk, 'metadata.url', '')
        const prefix = `[score: ${score}]${url ? ` ${url}` : ''}`
        return `${prefix}\n${chunk.text}`
      })
      .join('\n\n---\n\n')

    const systemMessage = {
      role: 'system',
      content: [
        'You are a helpful assistant specialized in Ragnarok Classic GGT (the Thai Ragnarok Online community forum).',
        'Answer questions based ONLY on the provided forum context below — do NOT use your own training knowledge about Ragnarok Online.',
        'Always answer in the same language as the question (Thai or English).',
        'If information is not in the context, say so clearly.',
        'Cite sources with topic URLs when relevant.',
        'When answering "how to" or step-by-step questions, include EVERY detail from the context — items, quantities, NPCs, coordinates, quest steps, prerequisites. Do NOT summarize or skip steps.',
        '',
        '── RO Abbreviation Reference (use ONLY for interpreting the user query, not as knowledge) ──',
        'OGH / OG = Old Glast Heim Memorial Dungeon',
        'AOGH = Advanced Old Glast Heim Memorial Dungeon',
        'ET = Endless Tower',
        'TT / Thana = Thanatos Tower',
        'NCT / NightmareCT = Nightmare Clock Tower Dungeon (NOT Nest of Faceworm)',
        'FW / Faceworm = The Nest of Faceworm',
        'HTF = Horror Toy Factory',
        'NBio / NB / Bio4 = Nightmare Bio Laboratory 4F',
        'GMT = Geffen Magic Tournament',
        'HOP = House of Prontera',
        'UT = Undersea Tunnel F6',
        'LK = Lord Knight',
        'HP / HPri = High Priest',
        'SinX / Sin = Assassin Cross',
        'WS = Whitesmith',
        'Wiz = High Wizard',
        'Prof = Professor / Scholar',
        'Champ = Champion',
        'Pala = Paladin',
        'Creator / Alc = Creator / Biochemist',
        'Awake / Awakened = the Awakening / Awakened class upgrade',
        'สไน = Sniper / Awakened Sniper',
        'MVP = boss monster',
        'EQ = Event Quest',
        'RC / Revo = Revo Classic Ragnarok Online',
        '',
        'Context:',
        contextString
      ].join('\n')
    }

    const recentHistory = history.slice(-6)

    const messages = [
      systemMessage,
      ...recentHistory,
      { role: 'user', content: query }
    ]

    const completion = await openai.chat.completions.create({
      model: aiConfig.openai.chatModel,
      messages,
      max_tokens: aiConfig.openai.maxTokens,
      temperature: 0.3
    })

    const answer = get(completion, 'choices[0].message.content', '')

    // Deduplicate sources by URL — keep highest score per topic URL.
    // Only surface sources above SOURCE_SCORE_THRESHOLD so low-relevance
    // tangentially-related topics are not shown as sources.
    const SOURCE_SCORE_THRESHOLD = 0.5
    const sourceMap = {}
    chunks.forEach(function (chunk) {
      const url = get(chunk, 'metadata.url', null)
      if (!url) return
      if (chunk.score < SOURCE_SCORE_THRESHOLD) return
      if (!sourceMap[url] || chunk.score > sourceMap[url].score) {
        sourceMap[url] = {
          score: chunk.score,
          url,
          type: get(chunk, 'metadata.type', null),
          title: get(chunk, 'metadata.title', null)
        }
      }
    })
    const sources = orderBy(Object.values(sourceMap), ['score'], ['desc'])

    return {
      answer,
      sources,
      images: collectImages(chunks),
      retrievedChunks: chunks.length
    }
  }

  return { chat }
}

module.exports = { createChatbot }

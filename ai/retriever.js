const { OpenAI } = require('openai')
const { get, map, uniqBy, orderBy } = require('lodash')
const aiConfig = require('./config')
const { createVectorStore } = require('./vectorStore')
const logger = require('../logger')

// ── Ragnarok Online abbreviation dictionary ────────────────────────────────
// Maps short player slang / acronyms → full in-game names used in forum text.
// Applied BEFORE embedding so the query vector aligns with document content.
const RO_ABBREV = {
  'ogh':       'Old Glast Heim Memorial Dungeon',
  'og':        'Old Glast Heim',
  'mh':        'Monster Hunter',
  'bio':       'Biolab Laboratory',
  'bio5':      'Biolab 5 Thanatos Tower',
  'gef':       'Geffen',
  'prt':       'Prontera',
  'pay':       'Payon',
  'moc':       'Morocc',
  'lhz':       'Lighthalzen',
  'ra':        'Rachel',
  'ayo':       'Ayothaya',
  'alde':      'Aldebaran',
  'hp':        'High Priest',
  'hpri':      'High Priest',
  'sniper':    'Sniper Awakened Sniper',
  'sin':       'Assassin Cross',
  'sinx':      'Assassin Cross',
  'ws':        'Whitesmith',
  'wiz':       'High Wizard',
  'prof':      'Professor Scholar',
  'champ':     'Champion',
  'clown':     'Clown',
  'gyp':       'Gypsy',
  'pala':      'Paladin',
  'lk':        'Lord Knight',
  'creator':   'Creator Biochemist',
  'stalker':   'Stalker',
  'awake':     'Awakened Awakening',
  'mvp':       'Monster Valuable Player boss monster',
  'mini':      'Mini boss monster',
  'eq':        'Event Quest',
  'ggt':       'Ragnarok Classic GGT',

  // ── Dungeons & Instances ───────────────────────────────────────────────────
  'aogh':      'Advanced Mode Old Glast Heim Memorial Dungeon',
  'et':        'Endless Tower Dungeon',
  'tt':        'Thanatos Tower Challenge',
  'thana':     'Thanatos Tower Challenge',
  'nbio':      'Nightmare Bio Laboratory 4F',
  'nb':        'Nightmare Bio Laboratory 4F',
  'bio4':      'Nightmare Bio Laboratory 4F',
  'nightmarebio': 'Nightmare Bio Laboratory 4F',
  'np':        'Nightmare Pyramid',
  'nct':       'Nightmare Clock Tower Dungeon',
  'nightmarect': 'Nightmare Clock Tower Dungeon',
  'fw':        'The Nest of Faceworm',
  'faceworm':  'The Nest of Faceworm',
  'htf':       'Horror Toy Factory',
  'gmt':       'Geffen Magic Tournament',
  'hop':       'House Of Prontera',
  'ut':        'Undersea Tunnel F6',
  'undersea':  'Undersea Tunnel F6',

  // ── Towns & Regions ────────────────────────────────────────────────────────
  'malaya':    'Port Malaya',
  'nw':        'New World Splendide Manuk',
  'splendide': 'New World Splendide',
  'manuk':     'New World Manuk',

  // ── Systems & Features ────────────────────────────────────────────────────
  'se':        'Socket Enchant',
  'sdq':       'Special Daily Quest',
  'sn':        'Super Novice Expansion',
  'fishing':   'Fishing AFK System',
  'gmland':    'GM Land',
  'pt':        'Party System',
  'baseexp':   'Base Exp Experience Table',
  'revo':      'Revo Classic Ragnarok Online',
  'rc':        'Revo Classic Ragnarok Online',
  'roc':       'Ragnarok Online Classic',
  'drop':      'Drop Item Rate',

  // ── Classes ───────────────────────────────────────────────────────────────
  'alc':       'Alchemist Creator Biochemist',
  'alche':     'Alchemist Creator Biochemist',
  'crus':      'Crusader Paladin',
  'crusader':  'Crusader Paladin เควสเปลี่ยนอาชีพ เปลียนอาชีพ',
  'bs':        'Blacksmith Whitesmith',
  'ko':        'Kagerou Oboro',
  'kage':      'Kagerou',
  'oboro':     'Oboro',

  // ── Events ────────────────────────────────────────────────────────────────
  'kfp':       'Kung Fu Panda Collaboration Quest',
  'lkt':       'Loy Krathong Event',
  'val':       'Valentine Event',
  'cny':       'Lunar New Year Chinese New Year Event',
  'xmas':      'Christmas X Mas Event',
}

// Expand known RO abbreviations found in the query string.
// Returns the query with abbreviations replaced / appended inline.
function expandAbbreviations (query) {
  const words = query.split(/\s+/)
  const extras = []
  for (const word of words) {
    const key = word.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (RO_ABBREV[key]) {
      extras.push(RO_ABBREV[key])
    }
  }
  if (extras.length === 0) return query
  return query + ' ' + extras.join(' ')
}

// ── Query expansion ────────────────────────────────────────────────────────
// Generate alternative phrasings in both Thai and English so that embeddings
// cover different semantic angles of the same question.
// Returns the original query plus up to 2 expansions.

async function expandQuery (openai, query) {
  const prompt = [
    'You are a search query expander for a Ragnarok Online (Thai community) knowledge base.',
    'IMPORTANT RULES:',
    '1. Always expand any Ragnarok Online abbreviations to their FULL in-game names.',
    '   Examples: OGH → "Old Glast Heim Memorial Dungeon", LK → "Lord Knight", HP → "High Priest",',
    '   Awake/Awakened → full class name, สไน → "Sniper / Awakened Sniper".',
    '2. Generate exactly 2 alternative queries — one in Thai, one in English.',
    '3. Each query must use the FULL dungeon/class/skill name, not abbreviations.',
    '4. Output ONLY the 2 queries, one per line, no numbering, no extra text.',
    '',
    `Question: ${query}`
  ].join('\n')

  try {
    const resp = await openai.chat.completions.create({
      model: aiConfig.openai.chatModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
      temperature: 0
    })
    const raw = get(resp, 'choices[0].message.content', '')
    const lines = raw.split('\n').map(function (l) { return l.trim() }).filter(Boolean)
    return lines.slice(0, 2)
  } catch (err) {
    logger.warn(`Query expansion failed: ${err.message} — using original only`)
    return []
  }
}

// ── Embed a batch of texts in one API call ─────────────────────────────────

async function embedBatch (openai, texts) {
  const resp = await openai.embeddings.create({
    model: aiConfig.openai.embeddingModel,
    input: texts
  })
  return resp.data
    .slice()
    .sort(function (a, b) { return a.index - b.index })
    .map(function (d) { return d.embedding })
}

// ── Main retriever ─────────────────────────────────────────────────────────

const createRetriever = function () {
  const openai = new OpenAI({
    apiKey: aiConfig.openai.apiKey,
    baseURL: aiConfig.openai.baseURL
  })
  const vectorStore = createVectorStore()

  const retrieve = async function (query, options = {}) {
    // Fetch more candidates per sub-query so the merged set is rich
    const topK           = get(options, 'topK',           aiConfig.retrieval.topK)
    const filter         = get(options, 'filter',         null)
    const scoreThreshold = get(options, 'scoreThreshold', aiConfig.retrieval.scoreThreshold)
    const perQueryK      = Math.ceil(topK * 1.5) // grab extra per sub-query

    // 1. Expand abbreviations in the original query (fast, no API call)
    const expandedQuery = expandAbbreviations(query)
    if (expandedQuery !== query) {
      logger.info(`Abbreviation expanded: "${query}" → "${expandedQuery}"`)
    }

    // 2. Generate LLM-based alternative phrasings (forces full name expansion)
    const expansions = await expandQuery(openai, expandedQuery)
    const allQueries = [expandedQuery, ...expansions]

    logger.info(`Multi-query retrieve — ${allQueries.length} queries: ${allQueries.map(function (q) { return '"' + q.slice(0, 40) + '"' }).join(' | ')}`)

    // 2. Embed all queries in a single API call
    const vectors = await embedBatch(openai, allQueries)

    // 3. Search Qdrant for each query vector in parallel
    const searchResults = await Promise.all(
      vectors.map(function (vec) {
        return vectorStore.search(vec, perQueryK, filter)
      })
    )

    // 4. Flatten, map to unified shape, apply threshold
    const allHits = []
    for (const results of searchResults) {
      for (const item of results) {
        const score = get(item, 'score', 0)
        if (score < scoreThreshold) continue
        allHits.push({
          score,
          text:     get(item, 'payload.text', ''),
          metadata: get(item, 'payload', {})
        })
      }
    }

    // 5. Deduplicate by text, keep the highest score seen for each unique chunk
    const byText = {}
    for (const hit of allHits) {
      const key = hit.text
      if (!byText[key] || hit.score > byText[key].score) {
        byText[key] = hit
      }
    }

    // 6. Sort by score descending, take topK
    const merged = orderBy(Object.values(byText), ['score'], ['desc']).slice(0, topK)

    logger.info(`Retrieved ${merged.length} unique chunks for query: "${expandedQuery.slice(0, 60)}..."`)

    return merged
  }

  return { retrieve }
}

module.exports = { createRetriever }

require('dotenv').config()

const fs = require('fs-extra')
const logger = require('./logger')
const fetcher = require('./crawler/fetcher')
const parser = require('./crawler/parser')
const extractor = require('./crawler/extractor')
const writer = require('./storage/writer')

// Retry 2: last 2 remaining failures
const TOPIC_IDS = [97617, 49232]

const BASE_TOPIC_URL = 'https://ro-prt.in.th/forum/index.php?app=forums&module=forums&controller=topic&id='

function makeTopicUrl (id) {
  return BASE_TOPIC_URL + id
}

async function processTopic (id) {
  const url = makeTopicUrl(id)
  let html

  try {
    html = await fetcher.fetch(url)
  } catch (err) {
    logger.warn(`Fetch failed for topic ${id}: ${err.message}`)
    return { id, status: 'fetch_failed' }
  }

  const { $ } = parser.parse(html, url)

  const classification = { type: 'topic', id: String(id) }
  const data = extractor.extract($, url, classification)

  if (!data) {
    logger.warn(`Extractor returned null for topic ${id}`)
    return { id, status: 'extract_failed' }
  }

  const records = Array.isArray(data) ? data : [data]

  const topic = records.find(function (r) { return r.type === 'topic' })
  const posts = records.filter(function (r) { return r.type === 'post' })

  logger.info(`Topic ${id}: "${topic ? topic.title : '?'}" — ${posts.length} posts`)

  for (const record of records) {
    if (record.type === 'topic') {
      await writer.write(record)
      await writer.appendManifest('topic', { id: record.id, slug: record.slug, url })
    } else if (record.type === 'post') {
      await writer.write(record)
    }
  }

  return { id, status: 'ok', posts: posts.length }
}

async function run () {
  await fs.ensureDir('./output/topics')
  await fs.ensureDir('./output/posts')

  logger.info(`Starting targeted crawl of ${TOPIC_IDS.length} topics`)

  let done = 0
  let failed = 0

  // Process topics sequentially through the fetcher queue (concurrency handled by config)
  const promises = TOPIC_IDS.map(function (id) {
    return fetcher.queue.add(async function () {
      const result = await processTopic(id)
      done++
      if (result.status !== 'ok') failed++
      logger.info(`Progress: ${done}/${TOPIC_IDS.length} | Failed: ${failed}`)
      return result
    })
  })

  const results = await Promise.all(promises)

  const ok = results.filter(function (r) { return r.status === 'ok' })
  const fail = results.filter(function (r) { return r.status !== 'ok' })

  logger.info(`Crawl complete — OK: ${ok.length} | Failed: ${fail.length}`)

  if (fail.length > 0) {
    logger.warn('Failed topic IDs: ' + fail.map(function (r) { return r.id }).join(', '))
  }
}

run().catch(function (err) {
  logger.error(`Fatal: ${err.message}`)
  process.exit(1)
})

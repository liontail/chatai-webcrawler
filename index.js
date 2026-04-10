require('dotenv').config()

const fs = require('fs-extra')
const path = require('path')
const config = require('./config')
const logger = require('./logger')
const { createQueue } = require('./crawler/queue')
const fetcher = require('./crawler/fetcher')
const router = require('./crawler/router')
const parser = require('./crawler/parser')
const extractor = require('./crawler/extractor')
const writer = require('./storage/writer')
const { shouldSave } = require('./crawler/filter')

const queue = createQueue()

let processedCount = 0

async function processUrl (url) {
  const classification = router.classify(url)
  if (classification.type === 'unknown') {
    logger.debug(`Skipping unknown URL: ${url}`)
    return
  }

  let html
  try {
    html = await fetcher.fetch(url)
  } catch (err) {
    logger.warn(`Fetch failed for ${url}: ${err.message}`)
    return
  }

  const { $, links } = parser.parse(html, url)

  // Only enqueue topic + search result pages — skip members, unrelated forums, etc.
  // This prevents the queue from bloating with thousands of unrelated URLs
  for (const link of links) {
    const linkType = router.classify(link).type
    if (linkType === 'topic' || linkType === 'search_results') {
      queue.enqueue(link)
    }
  }

  const data = extractor.extract($, url, classification)

  // ── Search results: enqueue discovered topic/forum links + next page ────────
  if (data && data.type === 'search_results') {
    if (Array.isArray(data.links)) {
      for (const link of data.links) {
        queue.enqueue(link)
      }
    }

    // Enqueue next search-results page if a "next" pagination link is present.
    const $nextSearchPage = $('[data-role="paginationBottom"] a[rel="next"], .ipsPagination_next a').first()
    if ($nextSearchPage.length) {
      const nextHref = $nextSearchPage.attr('href')
      if (nextHref) {
        try {
          const nextUrl = new URL(nextHref, url).toString()
          queue.enqueue(nextUrl)
        } catch (_) {
          // malformed href — skip
        }
      }
    }

    // Do NOT persist the search page itself — it is only a discovery vehicle.
    processedCount++
    if (processedCount % 10 === 0) {
      logger.info(`Processed: ${processedCount} | Queue: ${queue.size()} | Seen: ${queue.seenSize()}`)
    }
    return
  }

  // ── Stream: enqueue discovered topic links + next page, then save records ───
  if (Array.isArray(data) && data.length > 0 && data[0].type === 'stream_item') {
    // Enqueue all topic URLs discovered on this stream page
    const streamLinks = data[0].links
    if (Array.isArray(streamLinks)) {
      for (const link of streamLinks) {
        queue.enqueue(link)
      }
    }

    // Enqueue next stream page (IPS activity stream pagination)
    const $nextStreamPage = $('[data-role="tablePagination"] a[rel="next"], .ipsPagination_next a').first()
    if ($nextStreamPage.length) {
      const nextHref = $nextStreamPage.attr('href')
      if (nextHref) {
        try {
          const nextUrl = new URL(nextHref, url).toString()
          queue.enqueue(nextUrl)
        } catch (_) {
          // malformed href — skip
        }
      }
    }

    // Still persist the stream_item records to disk
    for (const record of data) {
      await writer.writeBatch([record])
    }

    processedCount++
    if (processedCount % 10 === 0) {
      logger.info(`Processed: ${processedCount} | Queue: ${queue.size()} | Seen: ${queue.seenSize()}`)
    }
    return
  }

  if (Array.isArray(data)) {
    if (!shouldSave(data[0], $)) {
      processedCount++
      if (processedCount % 10 === 0) {
        logger.info(`Processed: ${processedCount} | Queue: ${queue.size()} | Seen: ${queue.seenSize()}`)
      }
      return
    }
    for (const record of data) {
      await writer.writeBatch([record])
    }
  } else if (data && typeof data === 'object') {
    if (!shouldSave(data, $)) {
      processedCount++
      if (processedCount % 10 === 0) {
        logger.info(`Processed: ${processedCount} | Queue: ${queue.size()} | Seen: ${queue.seenSize()}`)
      }
      return
    }
    await writer.write(data)
    await writer.appendManifest(data.type, { id: data.id, slug: data.slug, url })
  }

  processedCount++

  if (processedCount % 10 === 0) {
    logger.info(`Processed: ${processedCount} | Queue: ${queue.size()} | Seen: ${queue.seenSize()}`)
  }
}

async function run () {
  await fs.ensureDir(config.outputDir)
  await fs.ensureDir('./logs')

  queue.enqueue(config.startUrl)

  logger.info(`Crawler starting — seed: ${config.startUrl}`)

  // Feed loop: push URLs into PQueue one at a time.
  // onEmpty() fires instantly (tasks start immediately), so we use a
  // 200ms yield instead — this keeps the event loop free for HTTP callbacks.
  while (true) {
    if (queue.hasPending()) {
      // Feed up to concurrency slots available in PQueue
      const slots = config.concurrency - fetcher.queue.pending
      const count = Math.max(1, slots)
      const batch = queue.dequeue(count)
      for (const url of batch) {
        fetcher.queue.add(function () { return processUrl(url) })
      }
      // Yield briefly so HTTP responses can be processed
      await new Promise(function (r) { setTimeout(r, 200) })
    } else if (fetcher.queue.pending > 0 || fetcher.queue.size > 0) {
      // URL queue empty but PQueue still has in-flight requests — wait for idle
      await fetcher.queue.onIdle()
    } else {
      // Both queues fully drained
      break
    }
  }

  logger.info(`Crawl complete — processed ${processedCount} pages`)
}

process.on('SIGINT', async function () {
  logger.info('SIGINT received — writing checkpoint...')
  const checkpointPath = path.join(config.outputDir, 'checkpoint.json')
  await fs.writeJson(checkpointPath, { seen: [...queue.seenSet()] }, { spaces: 2 })
  logger.info(`Checkpoint written to ${checkpointPath}`)
  process.exit(0)
})

run().catch(function (err) {
  logger.error(`Fatal error: ${err.message}`)
  process.exit(1)
})

const http = require('http')
const PQueue = require('p-queue').default
const config = require('../config')
const logger = require('../logger')

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1'

// Shared concurrency-limited request queue — index.js accesses fetcher.queue directly
const queue = new PQueue({
  concurrency: config.concurrency,
  interval: config.rateLimit,
  intervalCap: config.concurrency
})

// Simple HTTP POST using built-in http module (avoids axios/fetch compat issues on Node 22)
function httpPost (urlStr, body, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const parsed = new URL(urlStr)
    const data = JSON.stringify(body)
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, function (res) {
      let raw = ''
      res.on('data', function (chunk) { raw += chunk })
      res.on('end', function () {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(raw) }) } catch (e) { reject(new Error('FlareSolverr response parse error: ' + raw.slice(0, 100))) }
      })
    })
    req.setTimeout(timeoutMs, function () {
      req.destroy()
      reject(new Error('FlareSolverr request timed out after ' + timeoutMs + 'ms'))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function fetch (url, attempt = 1) {
  try {
    const { statusCode, body } = await httpPost(
      FLARESOLVERR_URL,
      { cmd: 'request.get', url, maxTimeout: config.requestTimeout },
      config.requestTimeout + 15000
    )

    if (statusCode !== 200 || body.status !== 'ok') {
      const msg = (body && body.message) || `FlareSolverr HTTP ${statusCode}`
      throw new Error(msg)
    }

    const solution = body.solution
    const pageStatus = solution.status
    const html = solution.response

    if (pageStatus === 403 || pageStatus === 429) {
      logger.warn(`[${pageStatus}] ${url} — attempt ${attempt}/${config.retries}`)
      if (attempt < config.retries) {
        const delay = config.retryDelay * Math.pow(2, attempt - 1)
        await new Promise(function (r) { setTimeout(r, delay) })
        return fetch(url, attempt + 1)
      }
      throw new Error(`HTTP ${pageStatus} after ${config.retries} attempts: ${url}`)
    }

    logger.debug(`Fetched [${pageStatus}] ${url}`)
    return html
  } catch (err) {
    if (attempt < config.retries) {
      logger.warn(`Fetch error for ${url}: ${err.message} — retry ${attempt + 1}/${config.retries}`)
      const delay = config.retryDelay * Math.pow(2, attempt - 1)
      await new Promise(function (r) { setTimeout(r, delay) })
      return fetch(url, attempt + 1)
    }
    throw err
  }
}

module.exports = { fetch, queue }

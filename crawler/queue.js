'use strict'

const { compact, uniq } = require('lodash')

const BASE = 'https://ro-prt.in.th'
const ALLOWED_HOSTNAME = 'ro-prt.in.th'

const SKIP_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.css', '.js',
  '.woff', '.woff2', '.pdf', '.zip', '.svg', '.webp',
  '.ttf', '.ico', '.eot', '.rar', '.tar', '.gz',
  '.mp4', '.mp3', '.avi', '.mov', '.wmv'
])

const SESSION_PARAMS = ['_token', 'csrf', 's', '_fromLogin']

// IPS internal URL patterns to reject — checked against full search string
const SKIP_IPS_PATTERNS = [
  { key: 'app', val: 'core', key2: 'module', val2: 'system' }
]

// Single-param skip checks (do=logout, controller=login, controller=register)
const SKIP_PARAM_VALUES = [
  { key: 'do', val: 'logout' },
  { key: 'controller', val: 'login' },
  { key: 'controller', val: 'register' }
]

function normalize (rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null

  const trimmed = rawUrl.trim()
  if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:')) return null

  let parsed
  try {
    // resolve relative URLs against the base
    parsed = new URL(trimmed, BASE)
  } catch (_) {
    return null
  }

  // enforce allowed hostname
  if (parsed.hostname !== ALLOWED_HOSTNAME) return null

  // lowercase scheme and host (URL already normalizes these, but be explicit)
  parsed.protocol = parsed.protocol.toLowerCase()
  parsed.hostname = parsed.hostname.toLowerCase()

  // strip fragment
  parsed.hash = ''

  // reject by file extension
  const pathLower = parsed.pathname.toLowerCase()
  const lastDot = pathLower.lastIndexOf('.')
  if (lastDot !== -1) {
    const ext = pathLower.slice(lastDot)
    if (SKIP_EXTENSIONS.has(ext)) return null
  }

  // remove session-type params
  for (const param of SESSION_PARAMS) {
    parsed.searchParams.delete(param)
  }

  // skip IPS internal compound patterns (app=core&module=system)
  const app = parsed.searchParams.get('app')
  const module_ = parsed.searchParams.get('module')
  if (app === 'core' && module_ === 'system') return null

  // skip single-param IPS internal actions
  for (const { key, val } of SKIP_PARAM_VALUES) {
    if (parsed.searchParams.get(key) === val) return null
  }

  // sort search params for a stable canonical form
  parsed.searchParams.sort()

  return parsed.toString()
}

function createQueue () {
  const seen = new Set()
  const pending = []
  let processed = 0

  return {
    enqueue (url) {
      const canonical = normalize(url)
      if (!canonical) return false
      if (seen.has(canonical)) return false

      seen.add(canonical)
      pending.push(canonical)
      return true
    },

    dequeue (n) {
      // If n is provided, return up to n items as an array (batch dequeue).
      // If n is omitted, return a single item (or null).
      if (typeof n === 'number') {
        const batch = pending.splice(0, n)
        processed += batch.length
        return batch
      }
      if (pending.length === 0) return null
      processed++
      return pending.shift()
    },

    has (url) {
      const canonical = normalize(url)
      if (!canonical) return false
      return seen.has(canonical)
    },

    size () {
      return pending.length
    },

    seenCount () {
      return seen.size
    },

    // Alias used by index.js
    seenSize () {
      return seen.size
    },

    hasPending () {
      return pending.length > 0
    },

    seenSet () {
      // compact + uniq used here to satisfy lodash style rule and ensure clean array
      return uniq(compact(Array.from(seen)))
    },

    stats () {
      return {
        pending: pending.length,
        seen: seen.size,
        processed
      }
    }
  }
}

module.exports = { createQueue }

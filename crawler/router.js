// Classifies a URL into a content type understood by the extractor layer.
// Handles both IPS4 query-string URLs and friendly URL paths.
// Returns { type, id, slug }

const { find } = require('lodash')

const RULES = [
  // ── Search results ──────────────────────────────────────────────────────────
  {
    type: 'search_results',
    test (p) {
      if (p.searchParams.get('app') === 'core' &&
          p.searchParams.get('module') === 'search' &&
          p.searchParams.get('controller') === 'search') return true
      if (p.pathname.includes('/search/')) return true
      return false
    },
    extractId: function () { return null },
    extractSlug: function () { return null }
  },

  // ── Stream / activity ───────────────────────────────────────────────────────
  {
    type: 'stream',
    test (p) {
      if (p.searchParams.get('app') === 'core' &&
          p.searchParams.get('module') === 'discover' &&
          p.searchParams.get('controller') === 'streams') return true
      if (p.pathname.includes('/discover/') || p.pathname.includes('/activity/')) return true
      return false
    },
    extractId: function () { return null },
    extractSlug: function () { return null }
  },

  // ── Topic ───────────────────────────────────────────────────────────────────
  // Query-string: ?app=forums&module=forums&controller=topic&id=123
  // Friendly:     /topic/123-some-slug/
  {
    type: 'topic',
    test (p) {
      if (p.searchParams.get('app') === 'forums' &&
          p.searchParams.get('module') === 'forums' &&
          p.searchParams.get('controller') === 'topic') return true
      if (/\/topic\/\d+/.test(p.pathname)) return true
      return false
    },
    extractId (p) {
      if (p.searchParams.has('id')) return p.searchParams.get('id')
      const m = p.pathname.match(/\/topic\/(\d+)/)
      return m ? m[1] : null
    },
    extractSlug (p) {
      const m = p.pathname.match(/\/topic\/\d+-([\w-]+)/)
      return m ? m[1] : null
    }
  },

  // ── Individual forum / subforum ─────────────────────────────────────────────
  // Query-string: ?app=forums&module=forums&controller=forums&id=42
  // Friendly:     /forum/42-name/
  {
    type: 'forum',
    test (p) {
      if (p.searchParams.get('app') === 'forums' &&
          p.searchParams.get('module') === 'forums' &&
          p.searchParams.get('controller') === 'forums') return true
      if (/\/forum\/\d+/.test(p.pathname)) return true
      return false
    },
    extractId (p) {
      if (p.searchParams.has('id')) return p.searchParams.get('id')
      const m = p.pathname.match(/\/forum\/(\d+)/)
      return m ? m[1] : null
    },
    extractSlug (p) {
      const m = p.pathname.match(/\/forum\/\d+-([\w-]+)/)
      return m ? m[1] : null
    }
  },

  // ── Forum index (top-level listing) ────────────────────────────────────────
  // Query-string: ?app=forums&module=forums&controller=index
  // Path:         /forum/ or /forum
  {
    type: 'forums_list',
    test (p) {
      if (p.searchParams.get('app') === 'forums' &&
          p.searchParams.get('module') === 'forums' &&
          p.searchParams.get('controller') === 'index') return true
      if (p.pathname === '/forum/' || p.pathname === '/forum') return true
      return false
    },
    extractId: function () { return null },
    extractSlug: function () { return null }
  },

  // ── Member profile ──────────────────────────────────────────────────────────
  // Query-string: ?app=core&module=members&controller=profile&id=55
  // Friendly:     /profile/55-name/
  {
    type: 'member',
    test (p) {
      if (p.searchParams.get('app') === 'core' &&
          p.searchParams.get('module') === 'members' &&
          p.searchParams.get('controller') === 'profile') return true
      if (/\/profile\/\d+/.test(p.pathname)) return true
      return false
    },
    extractId (p) {
      if (p.searchParams.has('id')) return p.searchParams.get('id')
      const m = p.pathname.match(/\/profile\/(\d+)/)
      return m ? m[1] : null
    },
    extractSlug (p) {
      const m = p.pathname.match(/\/profile\/\d+-([\w-]+)/)
      return m ? m[1] : null
    }
  }
]

function classify (url) {
  let parsed
  try { parsed = new URL(url) } catch (_) {
    return { type: 'unknown', id: null, slug: null }
  }

  for (const rule of RULES) {
    if (!rule.test(parsed)) continue
    return {
      type: rule.type,
      id: rule.extractId(parsed),
      slug: rule.extractSlug(parsed)
    }
  }

  return { type: 'unknown', id: null, slug: null }
}

module.exports = { classify }

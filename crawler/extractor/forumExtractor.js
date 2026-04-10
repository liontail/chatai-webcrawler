const { get, compact, map } = require('lodash')

// Parse an integer from a string like "1,234 topics"
function parseStatNumber (text) {
  if (!text) return 0
  const match = text.replace(/,/g, '').match(/\d+/)
  return match ? parseInt(match[0], 10) : 0
}

// Extract forum ID from an IPS forum URL
// e.g. /forum/12-general/ → "12"
function forumIdFromUrl (url) {
  if (!url) return null
  const match = url.match(/\/forum\/(\d+)[-/]/)
  return match ? match[1] : null
}

// Extract slug from URL path
function slugFromUrl (url) {
  if (!url) return ''
  try {
    const pathname = new URL(url).pathname
    // /forum/12-some-slug/ → "some-slug"
    const parts = pathname.replace(/\/$/, '').split('/')
    const last = parts[parts.length - 1]
    return last.replace(/^\d+-/, '')
  } catch (e) {
    return ''
  }
}

// Build a single forum object from a cheerio element or the whole page
function buildForumObject ($, el, classification, url) {
  const $el = el ? $(el) : $.root()

  // Try multiple title selectors
  let title = ''
  const titleCandidates = [
    $el.find('.ipsDataItem_title a').first(),
    $el.find('h2 a').first(),
    $el.find('.ipsType_sectionHead a').first(),
    $el.find('h1').first()
  ]
  for (const candidate of titleCandidates) {
    const text = candidate.text().trim()
    if (text) { title = text; break }
  }

  if (!title) return null

  // Description
  let description = null
  const descCandidates = [
    $el.find('.ipsDataItem_generic > p').first(),
    $el.find('.cForumDescription').first()
  ]
  for (const candidate of descCandidates) {
    const text = candidate.text().trim()
    if (text) { description = text; break }
  }

  // Stats — look for text nodes near "topics" and "posts" labels
  let topics = 0
  let posts = 0
  $el.find('*').each(function () {
    const text = $(this).text().toLowerCase()
    if (text.includes('topic') || text.includes('โพสต์หัวข้อ')) {
      const num = parseStatNumber($(this).text())
      if (num > 0 && topics === 0) topics = num
    }
    if (text.includes('post') || text.includes('โพสต์')) {
      const num = parseStatNumber($(this).text())
      if (num > 0 && posts === 0) posts = num
    }
  })

  // Sub-forum links
  const subForumIds = compact(map(
    $el.find('.cSubForumList a, .ipsSubForum a').toArray(),
    (a) => forumIdFromUrl($(a).attr('href'))
  ))

  // Forum URL from the title link
  const forumHref = titleCandidates.find(c => c.attr('href'))
  const forumUrl = forumHref
    ? (function () {
        try { return new URL(forumHref.attr('href'), url).toString() } catch (e) { return url }
      }())
    : url

  const id = get(classification, 'id') || forumIdFromUrl(forumUrl) || ''

  return {
    type: 'forum',
    id,
    slug: slugFromUrl(forumUrl),
    url: forumUrl,
    title,
    description,
    parentId: get(classification, 'parentId') || null,
    subForumIds,
    stats: { topics, posts },
    crawledAt: new Date().toISOString()
  }
}

function extract ($, url, classification) {
  try {
    const type = get(classification, 'type')

    if (type === 'forum') {
      return buildForumObject($, null, classification, url)
    }

    // forums_list — find all forum rows
    const rowSelectors = ['[data-forumid]', '.cForumList > li', '.ipsDataItem']
    let rows = []
    for (const sel of rowSelectors) {
      const found = $(sel)
      if (found.length > 0) { rows = found.toArray(); break }
    }

    if (rows.length === 0) {
      // Fall back to treating the whole page as a single forum
      const single = buildForumObject($, null, classification, url)
      return single ? [single] : null
    }

    const results = compact(map(rows, (el) => {
      // Per-row classification inherits from parent but id comes from data-forumid
      const rowClassification = Object.assign({}, classification, {
        id: $(el).attr('data-forumid') || get(classification, 'id')
      })
      return buildForumObject($, el, rowClassification, url)
    }))

    return results.length > 0 ? results : null
  } catch (e) {
    return null
  }
}

module.exports = { extract }

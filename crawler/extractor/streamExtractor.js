const { compact, map } = require('lodash')

function memberIdFromHref (href) {
  if (!href) return null
  const match = href.match(/\/profile\/(\d+)[-/]/)
  return match ? match[1] : null
}

// Infer content type from a URL string
function contentTypeFromUrl (url) {
  if (!url) return null
  if (url.includes('/topic/')) return 'topic'
  if (url.includes('/forum/')) return 'forum'
  if (url.includes('/profile/')) return 'member'
  return null
}

function extract ($, url, classification) {
  try {
    const itemSelectors = [
      'article.ipsStreamItem',
      '[data-role="activityItem"]',
      '[data-controller*="stream"]'
    ]

    let itemEls = []
    for (const sel of itemSelectors) {
      const found = $(sel)
      if (found.length > 0) { itemEls = found.toArray(); break }
    }

    if (itemEls.length === 0) return null

    const crawledAt = new Date().toISOString()

    const items = compact(map(itemEls, (el) => {
      const $el = $(el)

      // Actor
      const actorAttr = $el.attr('data-author') || ''
      const actorLinkEl = $el.find('.ipsStreamItem_author a').first()
      const actorHref = actorLinkEl.attr('href') || null
      const actorUsername = actorAttr ||
        actorLinkEl.text().trim() ||
        ''

      const actor = {
        id: memberIdFromHref(actorHref),
        username: actorUsername,
        profileUrl: actorHref
      }

      // Action verb — first meaningful text in the description element
      const descEl = $el.find('.ipsStreamItem_desc').first()
      // Strip child element text, keep only direct text nodes
      const actionText = descEl.contents().filter(function () {
        return this.type === 'text'
      }).first().text().trim()
      const action = actionText || descEl.text().trim()

      // Content title / URL
      const contentLinkEl = $el.find('.ipsStreamItem_title a, h3 a').first()
      const contentTitle = contentLinkEl.text().trim() || null
      const contentHref = contentLinkEl.attr('href') || null

      let contentUrl = null
      if (contentHref) {
        try { contentUrl = new URL(contentHref, url).toString() } catch (e) {}
      }

      // Timestamp
      const occurredAt = $el.find('time[datetime]').first().attr('datetime') || null

      return {
        type: 'stream_item',
        streamUrl: url,
        actor,
        action,
        contentTitle,
        contentUrl,
        contentType: contentTypeFromUrl(contentUrl),
        occurredAt,
        crawledAt
      }
    }))

    // Extract all topic URLs found on the stream page for enqueueing
    const topicUrlSet = new Set()
    const topicSelectors = [
      '.ipsStreamItem_title a[href]',
      '[data-role="title"] a[href]',
      'h3 a[href]',
      '.ipsStreamItem a[href]'
    ]
    for (const sel of topicSelectors) {
      $(sel).each(function (i, el) {
        const href = $(el).attr('href')
        if (!href) return
        // Only include links that point to topic pages
        if (!href.includes('/topic/') && !href.includes('topic')) return
        try {
          const resolved = new URL(href, url).toString()
          const parsedResolved = new URL(resolved)
          if (parsedResolved.hostname === 'ro-prt.in.th') {
            topicUrlSet.add(resolved)
          }
        } catch (e) {}
      })
    }
    const topicUrls = Array.from(topicUrlSet)

    if (items.length === 0) return null

    // Attach links to the first item so index.js can enqueue them
    items[0] = Object.assign({}, items[0], { links: topicUrls })

    return items
  } catch (e) {
    return null
  }
}

module.exports = { extract }

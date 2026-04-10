'use strict'

const { compact, uniq, map } = require('lodash')

// Selectors for IPS4 search result containers and their title links.
// We try multiple selector strategies to be resilient across IPS4 theme variations.
const RESULT_CONTAINERS = [
  '[data-role="results"] article',
  '.ipsStreamItem',
  '[data-controller*="search"] article'
]

const TITLE_LINK_SELECTORS = [
  '.ipsStreamItem_title a',
  'h3 a[href]',
  '.ipsType_sectionHead a'
]

// Resolve a potentially-relative href against the page URL.
function resolveHref (href, baseUrl) {
  if (!href) return null
  try {
    return new URL(href, baseUrl).toString()
  } catch (_) {
    return null
  }
}

function extract ($, url, classification) {
  try {
    const links = []

    // Try each container selector in priority order.
    // Use the first one that yields results.
    let $items = null
    for (const containerSel of RESULT_CONTAINERS) {
      const found = $(containerSel)
      if (found.length > 0) {
        $items = found
        break
      }
    }

    if ($items && $items.length > 0) {
      $items.each(function () {
        const $item = $(this)

        // Try each title-link selector within the item.
        for (const linkSel of TITLE_LINK_SELECTORS) {
          const $a = $item.find(linkSel).first()
          if ($a.length) {
            const resolved = resolveHref($a.attr('href'), url)
            if (resolved) {
              links.push(resolved)
              break
            }
          }
        }
      })
    }

    // Fallback: if no structured containers matched, grab all `<a>` elements
    // inside any element that looks like a results wrapper.
    if (links.length === 0) {
      $('[data-role="results"] a[href], .cSearchResults a[href]').each(function () {
        const resolved = resolveHref($(this).attr('href'), url)
        if (resolved) links.push(resolved)
      })
    }

    return {
      type: 'search_results',
      id: null,
      slug: null,
      url,
      links: uniq(compact(links)),
      crawledAt: new Date().toISOString()
    }
  } catch (_) {
    return null
  }
}

module.exports = { extract }

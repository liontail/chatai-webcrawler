const cheerio = require('cheerio')
const { uniq, compact, map } = require('lodash')

const TARGET_HOSTNAME = 'ro-prt.in.th'

function parse (html, baseUrl) {
  const $ = cheerio.load(html)
  const links = []

  $('a[href]').each(function () {
    const href = $(this).attr('href')
    if (!href) return

    try {
      // Reject hrefs that are clearly not URL paths (contain spaces or unencoded brackets)
      if (/[\s\[\]]/.test(href)) return

      const resolved = new URL(href, baseUrl)
      if (resolved.protocol !== 'https:') return
      if (resolved.hostname !== TARGET_HOSTNAME) return

      // Strip fragment anchors
      resolved.hash = ''
      links.push(resolved.toString())
    } catch (e) {
      // Skip malformed URLs
    }
  })

  return { $, links: uniq(compact(links)) }
}

module.exports = { parse }

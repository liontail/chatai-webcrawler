const { get, compact, map } = require('lodash')

function parseNumber (text) {
  if (!text) return 0
  const match = text.replace(/,/g, '').match(/\d+/)
  return match ? parseInt(match[0], 10) : 0
}

function idFromUrl (url, pattern) {
  if (!url) return null
  const match = url.match(pattern)
  return match ? match[1] : null
}

function slugFromUrl (url) {
  if (!url) return ''
  try {
    const pathname = new URL(url).pathname
    const parts = pathname.replace(/\/$/, '').split('/')
    const last = parts[parts.length - 1]
    return last.replace(/^\d+-/, '')
  } catch (e) {
    return ''
  }
}

// Extract forum ID from a breadcrumb link to the parent forum
// /forum/12-general/ → "12"
function forumIdFromHref (href) {
  if (!href) return null
  const match = href.match(/\/forum\/(\d+)[-/]/)
  return match ? match[1] : null
}

// Extract member profile ID from a profile URL
// /profile/42-username/ → "42"
function memberIdFromHref (href) {
  if (!href) return null
  const match = href.match(/\/profile\/(\d+)[-/]/)
  return match ? match[1] : null
}

const EMOJI_PATTERNS = ['/emoticons/', '/emoji/', 'emojione', '.emojione']
const TRACKER_PATTERNS = ['//www.google-analytics', '//www.facebook.com/tr']

const extractImages = ($post, postBaseUrl) => {
  const contentEl = $post.find('[data-role="commentContent"], .cPost_contentWrap, .ipsComment_content, .ipsType_richText').first()
  const imgEls = contentEl.find('img').toArray()

  const images = compact(map(imgEls, (imgEl) => {
    const src = (imgEl.attribs && imgEl.attribs.src) || ''
    if (!src) return null
    if (src.startsWith('data:')) return null

    const width = (imgEl.attribs && imgEl.attribs.width) || ''
    const height = (imgEl.attribs && imgEl.attribs.height) || ''
    if (width === '1' || height === '1') return null

    const cls = (imgEl.attribs && imgEl.attribs.class) || ''
    if (cls.includes('ipsEmoji')) return null

    const srcLower = src.toLowerCase()
    if (EMOJI_PATTERNS.some((p) => srcLower.includes(p))) return null
    if (TRACKER_PATTERNS.some((p) => srcLower.includes(p))) return null

    let resolvedUrl = src
    try {
      resolvedUrl = new URL(src, postBaseUrl).href
    } catch (e) {
      return null
    }

    const urlLower = resolvedUrl.toLowerCase()
    const isGif = urlLower.endsWith('.gif') ||
      urlLower.includes('?mime=gif') ||
      /[^a-z]gif([?#]|$)/.test(urlLower)

    const alt = (imgEl.attribs && imgEl.attribs.alt) || ''

    return { url: resolvedUrl, isGif, alt }
  }))

  const seen = new Set()
  const deduped = compact(images.map((img) => {
    if (seen.has(img.url)) return null
    seen.add(img.url)
    return img
  }))

  return deduped
}

function extract ($, url, classification) {
  try {
    // --- Topic title ---
    let title = ''
    const titleCandidates = [
      $('h1[data-role="pageTitle"]').first(),
      $('.ipsType_pageTitle').first(),
      $('h1.ipsPageHeader__title').first(),
      $('h1').first()
    ]
    for (const candidate of titleCandidates) {
      const text = candidate.text().trim()
      if (text) { title = text; break }
    }
    if (!title) return null

    // --- Forum ID from breadcrumb ---
    const breadcrumbLink = $('.ipsBreadcrumb li:nth-last-child(2) a').first()
    const forumId = forumIdFromHref(breadcrumbLink.attr('href'))

    // --- Topic stats ---
    let views = 0
    let replies = 0
    const headerInfo = $('.ipsPageHeader__info')
    headerInfo.find('*').each(function () {
      const text = $(this).text().toLowerCase()
      if (text.includes('view') || text.includes('ครั้ง')) {
        const num = parseNumber($(this).text())
        if (num > 0 && views === 0) views = num
      }
      if (text.includes('repl') || text.includes('ตอบกลับ')) {
        const num = parseNumber($(this).text())
        if (num > 0 && replies === 0) replies = num
      }
    })

    // --- Pinned / Locked ---
    const isPinned = $('.ipsBadge[data-badge="pinned"]').length > 0 ||
      $('[data-role="pinned"]').length > 0
    const isLocked = $('.ipsBadge[data-badge="locked"]').length > 0 ||
      $('[data-role="locked"]').length > 0

    // --- Tags ---
    const tags = compact(map($('.ipsTags a').toArray(), (a) => $(a).text().trim()))

    // --- Pagination ---
    let pageCount = 1
    const lastPageLink = $('[data-role="paginationTop"] li.last a, li.ipsPagination_last a').first()
    if (lastPageLink.length) {
      const lastHref = lastPageLink.attr('href') || ''
      const pageMatch = lastHref.match(/[?&]page=(\d+)/) || lastHref.match(/\/page\/(\d+)/)
      if (pageMatch) pageCount = parseInt(pageMatch[1], 10)
    }
    // Also check aria-label or text content of last page button
    if (pageCount === 1) {
      const lastText = lastPageLink.text().trim()
      const num = parseInt(lastText, 10)
      if (num > 1) pageCount = num
    }

    // --- Topic ID / slug from URL ---
    const topicId = get(classification, 'id') || idFromUrl(url, /\/topic\/(\d+)[-/]/) || ''
    const slug = slugFromUrl(url)

    // --- First post author (from first post article) ---
    // IPS4 uses div[data-commentid] with class .cPost (not always article)
    const allPostEls = $(
      '[data-commentid], .cPost'
    ).toArray().filter(function (el) {
      // must have a commentid attribute — deduplicate if both selectors match same el
      return el.attribs && el.attribs['data-commentid']
    }).filter(function (el, idx, arr) {
      return arr.findIndex(function (e) { return e.attribs['data-commentid'] === el.attribs['data-commentid'] }) === idx
    })

    // Build topic author from first post
    let topicAuthor = { id: '', username: '', profileUrl: '' }
    if (allPostEls.length > 0) {
      const firstEl = $(allPostEls[0])
      const authorAttr = firstEl.attr('data-author') || ''
      const hovercard = firstEl.find('[data-hovercard-id]').first()
      const profileLinkEl = firstEl.find('.ipsComment_author a[href*="/profile/"]').first()
      const profileHref = profileLinkEl.attr('href') || hovercard.attr('href') || ''
      topicAuthor = {
        id: hovercard.attr('data-hovercard-id') || memberIdFromHref(profileHref) || '',
        username: authorAttr || hovercard.text().trim() || profileLinkEl.text().trim(),
        profileUrl: profileHref
      }
    }

    // --- Date range from posts ---
    const allDates = compact(map(allPostEls, (el) => {
      const dt = $(el).find('time[datetime]').first().attr('datetime')
      return dt || null
    }))
    const firstPostDate = allDates.length > 0 ? allDates[0] : null
    const lastPostDate = allDates.length > 0 ? allDates[allDates.length - 1] : null

    const crawledAt = new Date().toISOString()

    const topicObj = {
      type: 'topic',
      id: topicId,
      slug,
      url,
      forumId,
      title,
      author: topicAuthor,
      isPinned,
      isLocked,
      tags,
      stats: { views, replies },
      pageCount,
      firstPostDate,
      lastPostDate,
      crawledAt
    }

    // --- Posts ---
    const postObjs = map(allPostEls, (el, idx) => {
      const $el = $(el)

      const commentId = $el.attr('data-commentid') || ''
      const authorAttr = $el.attr('data-author') || ''
      const hovercardEl = $el.find('[data-hovercard-id]').first()
      const profileLinkEl = $el.find('.ipsComment_author a[href*="/profile/"], a[href*="/profile/"]').first()
      const profileHref = profileLinkEl.attr('href') || hovercardEl.attr('href') || ''
      const avatarEl = $el.find('img.ipsUserPhoto, .ipsComment_author img').first()

      const authorId = hovercardEl.attr('data-hovercard-id') ||
        memberIdFromHref(profileHref) ||
        ''
      const username = authorAttr ||
        hovercardEl.text().trim() ||
        profileLinkEl.text().trim()

      // Body
      const bodyEl = $el.find('[data-role="commentContent"], .cPost_contentWrap, .ipsComment_content, .ipsType_richText').first()
      const body = bodyEl.html() || ''
      const bodyText = bodyEl.text().trim()

      // Dates
      const timeEls = $el.find('time[datetime]')
      const postedAt = timeEls.first().attr('datetime') || null
      const editedAt = timeEls.length > 1 ? timeEls.eq(1).attr('datetime') : null

      // Reactions
      const reactCountEl = $el.find('.ipsReact_reactCount').first()
      let reactionCount = 0
      if (reactCountEl.length) {
        reactionCount = parseNumber(reactCountEl.text())
      } else {
        reactionCount = $el.find('[data-reaction]').length
      }

      return {
        type: 'post',
        id: commentId,
        topicId,
        forumId,
        url: `${url}#comment-${commentId}`,
        author: {
          id: authorId,
          username,
          profileUrl: profileHref,
          avatar: avatarEl.attr('src') || null
        },
        body,
        bodyText,
        images: extractImages($el, url),
        postedAt,
        editedAt,
        reactionCount,
        isFirstPost: idx === 0,
        crawledAt
      }
    })

    return [topicObj, ...postObjs]
  } catch (e) {
    return null
  }
}

module.exports = { extract }

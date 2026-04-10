const { get } = require('lodash')

function parseNumber (text) {
  if (!text) return 0
  const match = text.replace(/,/g, '').match(/\d+/)
  return match ? parseInt(match[0], 10) : 0
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

function memberIdFromUrl (url) {
  if (!url) return ''
  const match = url.match(/\/profile\/(\d+)[-/]/)
  return match ? match[1] : ''
}

// Find a time[datetime] near a parent element that contains a label keyword
function findDateNearLabel ($, keywords) {
  let found = null
  $('*').each(function () {
    const text = $(this).text().toLowerCase()
    const matches = keywords.some(k => text.includes(k.toLowerCase()))
    if (matches) {
      const dt = $(this).find('time[datetime]').first().attr('datetime') ||
        $(this).closest('*').find('time[datetime]').first().attr('datetime')
      if (dt) { found = dt; return false }
    }
  })
  return found || null
}

// Find a stat value by looking for a label keyword in sibling/parent context
function findStatByLabel ($, container, keywords) {
  let found = 0
  container.find('li, dt, dd, span, div').each(function () {
    const text = $(this).text().toLowerCase()
    const matches = keywords.some(k => text.includes(k.toLowerCase()))
    if (matches) {
      found = parseNumber($(this).text())
      if (found > 0) return false
    }
  })
  return found
}

function extract ($, url, classification) {
  try {
    // --- Username / Display name ---
    let username = ''
    const nameCandidates = [
      $('h1[data-role="pageTitle"]').first(),
      $('.cProfileHeader_name').first(),
      $('h1.ipsPageHeader__title').first(),
      $('h1').first()
    ]
    for (const candidate of nameCandidates) {
      const text = candidate.text().trim()
      if (text) { username = text; break }
    }
    if (!username) return null

    // --- Member group ---
    let group = null
    const groupCandidates = [
      $('.cProfileHeader_rankBadge').first(),
      $('[data-membercss]').first()
    ]
    for (const candidate of groupCandidates) {
      const text = candidate.text().trim()
      if (text) { group = text; break }
    }

    // --- Avatar ---
    let avatar = null
    const avatarCandidates = [
      $('.cProfileHeader_photo img').first(),
      $('img.ipsUserPhoto').first()
    ]
    for (const candidate of avatarCandidates) {
      const src = candidate.attr('src')
      if (src) { avatar = src; break }
    }

    // --- Stats ---
    const statsContainer = $('.cProfileStats, .ipsProfileStats').first()
    const posts = findStatByLabel($, statsContainer, ['posts', 'โพสต์'])
    const reputation = findStatByLabel($, statsContainer, ['reputation', 'ชื่อเสียง'])

    // --- Dates ---
    const joinedAt = findDateNearLabel($, ['joined', 'เข้าร่วม'])
    const lastVisitedAt = findDateNearLabel($, ['last visited', 'last activity', 'เยี่ยมชมล่าสุด'])

    // --- Bio ---
    let bio = null
    const bioCandidates = [
      $('[data-role="aboutMe"]').first(),
      $('.cProfileField_value').first()
    ]
    for (const candidate of bioCandidates) {
      const text = candidate.text().trim()
      if (text) { bio = text; break }
    }

    const id = get(classification, 'id') || memberIdFromUrl(url)

    return {
      type: 'member',
      id,
      slug: slugFromUrl(url),
      url,
      username,
      displayName: username,
      group,
      avatar,
      bio,
      stats: { posts, reputation },
      joinedAt,
      lastVisitedAt,
      crawledAt: new Date().toISOString()
    }
  } catch (e) {
    return null
  }
}

module.exports = { extract }

const { get } = require('lodash')
const logger = require('../logger')
const config = require('../config')

const eventQuestConfig = get(config, 'filters.eventQuest', {})

const EVENT_QUEST_KEYWORDS = get(eventQuestConfig, 'keywords', ['event quest', 'eventquest', 'event-quest'])
const TODAY = new Date(get(eventQuestConfig, 'skipBefore', '2026-04-05') + 'T00:00:00.000Z')

const matchesKeywords = (str) => {
  if (!str || typeof str !== 'string') return false
  const lower = str.toLowerCase()
  return EVENT_QUEST_KEYWORDS.some(function (kw) { return lower.includes(kw) })
}

// Returns true if the record should be saved, false if it should be skipped
const shouldSave = (data, $) => {
  try {
    if (!data || data.type !== 'topic') return true

    if (get(eventQuestConfig, 'enabled') === false) return true

    let isEventQuest = false

    // 1. Check data.slug
    if (matchesKeywords(get(data, 'slug'))) {
      isEventQuest = true
    }

    // 2. Check data.url
    if (!isEventQuest && matchesKeywords(get(data, 'url'))) {
      isEventQuest = true
    }

    // 3. Check breadcrumb links from cheerio
    if (!isEventQuest && $) {
      const breadcrumbTexts = []
      $('.ipsBreadcrumb li a').each(function (i, el) {
        breadcrumbTexts.push($(el).text())
      })
      if (breadcrumbTexts.some(function (text) { return matchesKeywords(text) })) {
        isEventQuest = true
      }
    }

    // 4. Check data.forumId via breadcrumb parent forum title
    if (!isEventQuest && $) {
      const lastBreadcrumb = $('.ipsBreadcrumb li a').last().text()
      if (matchesKeywords(lastBreadcrumb)) {
        isEventQuest = true
      }
    }

    if (!isEventQuest) {
      // Classic filter — if enabled with strict title mode, skip topics whose title
      // doesn't contain any classic keyword
      const classicCfg = get(config, 'filters.classic', {})
      if (classicCfg.enabled && classicCfg.strictTitle && classicCfg.keywords.length > 0) {
        const title = get(data, 'title', '').toLowerCase()
        const hasClassicKeyword = classicCfg.keywords.some(kw => title.includes(kw.toLowerCase()))
        if (!hasClassicKeyword) {
          logger.debug('Skipping non-Classic topic: ' + data.title)
          return false
        }
      }
      return true
    }

    const rawDate = get(data, 'firstPostDate') || get(data, 'lastPostDate')
    if (!rawDate) return true

    const topicDate = new Date(rawDate)
    if (isNaN(topicDate.getTime())) return true

    if (topicDate < TODAY) {
      logger.debug('Skipping outdated Event Quest topic: ' + get(data, 'title') + ' | Date: ' + topicDate.toISOString())
      return false
    }

    return true
  } catch (err) {
    return true
  }
}

module.exports = { shouldSave }

const { get } = require('lodash')
const forumExtractor = require('./forumExtractor')
const topicExtractor = require('./topicExtractor')
const memberExtractor = require('./memberExtractor')
const streamExtractor = require('./streamExtractor')
const searchExtractor = require('./searchExtractor')

const EXTRACTOR_MAP = {
  forums_list: forumExtractor,
  forum: forumExtractor,
  topic: topicExtractor,
  member: memberExtractor,
  stream: streamExtractor,
  search_results: searchExtractor
}

// Returns data object, array of objects, or null
const extract = ($, url, classification) => {
  const type = get(classification, 'type')
  if (!type) return null

  const extractor = EXTRACTOR_MAP[type]
  if (!extractor) return null

  return extractor.extract($, url, classification)
}

module.exports = { extract }

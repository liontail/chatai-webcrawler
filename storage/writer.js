const fse = require('fs-extra')
const path = require('path')
const { get, kebabCase } = require('lodash')
const config = require('../config')
const logger = require('../logger')

const TYPE_DIR_MAP = {
  forum: 'forums',
  forums_list: 'forums',
  topic: 'topics',
  post: 'posts',
  member: 'members',
  stream_item: 'streams'
}

const OUTPUT_BASE = path.resolve(config.outputDir)

function dailyDate () {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

async function write (data) {
  try {
    const dir = TYPE_DIR_MAP[data.type]
    if (!dir) {
      logger.debug(`write: unknown type "${data.type}", skipping`)
      return
    }

    let filePath

    if (data.type === 'stream_item') {
      filePath = path.join(OUTPUT_BASE, 'streams', `${dailyDate()}.json`)
      let existing = []
      try {
        existing = await fse.readJson(filePath)
      } catch (_) {
        existing = []
      }
      existing.push(data)
      await fse.outputJson(filePath, existing, { spaces: 2 })
      logger.debug(`Wrote ${data.type} → ${filePath}`)
      return
    }

    if (data.type === 'post') {
      const topicId = get(data, 'topicId') || get(data, 'topic_id')
      const id = get(data, 'id')
      if (!topicId || !id) {
        logger.debug('write: post missing topicId or id, skipping')
        return
      }
      filePath = path.join(OUTPUT_BASE, 'posts', String(topicId), `${id}.json`)
    } else {
      const id = get(data, 'id')
      const slug = get(data, 'slug')
      if (id && slug) {
        filePath = path.join(OUTPUT_BASE, dir, `${id}-${kebabCase(slug)}.json`)
      } else if (id) {
        filePath = path.join(OUTPUT_BASE, dir, `${id}.json`)
      } else {
        logger.debug(`write: record missing id for type "${data.type}", skipping`)
        return
      }
    }

    await fse.outputJson(filePath, data, { spaces: 2 })
    logger.debug(`Wrote ${data.type} → ${filePath}`)
  } catch (err) {
    logger.error(`write error for type "${get(data, 'type')}": ${err.message}`)
  }
}

async function writeBatch (records) {
  // Ensure post subdirs exist first, grouped by topicId
  const postTopicIds = new Set()
  for (const record of records) {
    if (record.type === 'post') {
      const topicId = get(record, 'topicId') || get(record, 'topic_id')
      if (topicId) postTopicIds.add(String(topicId))
    }
  }

  await Promise.all(
    [...postTopicIds].map(topicId =>
      fse.ensureDir(path.join(OUTPUT_BASE, 'posts', topicId))
    )
  )

  for (const record of records) {
    await write(record)
  }
}

async function appendManifest (type, entry) {
  try {
    const dir = TYPE_DIR_MAP[type]
    if (!dir) {
      logger.debug(`appendManifest: unknown type "${type}", skipping`)
      return
    }

    const filePath = path.join(OUTPUT_BASE, dir, 'index.json')

    let existing = []
    try {
      existing = await fse.readJson(filePath)
    } catch (_) {
      existing = []
    }

    const alreadyExists = existing.some(item => item.id === entry.id)
    if (alreadyExists) {
      logger.debug(`appendManifest: entry id=${entry.id} already in ${filePath}, skipping`)
      return
    }

    existing.push(entry)
    await fse.outputJson(filePath, existing, { spaces: 2 })
    logger.debug(`appendManifest: updated ${filePath} (${existing.length} entries)`)
  } catch (err) {
    logger.error(`appendManifest error for type "${type}": ${err.message}`)
  }
}

async function ensureOutputDirs () {
  const dirs = Object.values(TYPE_DIR_MAP)
  const unique = [...new Set(dirs)]
  await Promise.all(
    unique.map(subdir => fse.ensureDir(path.join(OUTPUT_BASE, subdir)))
  )
  logger.debug('ensureOutputDirs: all output subdirectories ready')
}

module.exports = {
  write,
  writeBatch,
  appendManifest,
  ensureOutputDirs
}

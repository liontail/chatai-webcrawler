require('dotenv').config()

const path = require('path')
const fse = require('fs-extra')
const { chunk } = require('lodash')
const { prepareDocuments, embed } = require('./embedder')
const { createVectorStore } = require('./vectorStore')
const aiConfig = require('./config')
const logger = require('../logger')

const OUTPUT_DIR = path.resolve(__dirname, '..', 'output')

const SUBDIRS = ['forums', 'topics', 'members']

async function collectJsonFiles (subdir) {
  const dirPath = path.join(OUTPUT_DIR, subdir)
  const exists = await fse.pathExists(dirPath)
  if (!exists) return []

  const entries = await fse.readdir(dirPath)
  const files = []

  for (const entry of entries) {
    if (entry === 'index.json') continue
    const full = path.join(dirPath, entry)
    if (full.endsWith('.json')) {
      files.push(full)
    }
  }

  return files
}

async function collectPostFiles () {
  const postsDir = path.join(OUTPUT_DIR, 'posts')
  const exists = await fse.pathExists(postsDir)
  if (!exists) return []

  const topicDirs = await fse.readdir(postsDir)
  const files = []

  for (const topicId of topicDirs) {
    const topicPath = path.join(postsDir, topicId)
    const stat = await fse.stat(topicPath)
    if (!stat.isDirectory()) continue

    const entries = await fse.readdir(topicPath)
    for (const entry of entries) {
      if (entry === 'index.json') continue
      if (entry.endsWith('.json')) {
        files.push(path.join(topicPath, entry))
      }
    }
  }

  return files
}

async function getAllFiles () {
  const results = []

  for (const subdir of SUBDIRS) {
    const files = await collectJsonFiles(subdir)
    results.push(...files)
  }

  const postFiles = await collectPostFiles()
  results.push(...postFiles)

  return results
}

async function flushBatch (vectorStore, buffer, progress) {
  if (buffer.length === 0) return

  const texts = buffer.map(function (d) { return d.text })
  const embeddings = await embed(texts)

  const zipped = buffer.map(function (doc, i) {
    return { ...doc, embedding: embeddings[i] }
  })

  await vectorStore.upsert(zipped)

  progress.documents += buffer.length
  logger.info(`Ingested batch: ${buffer.length} docs | Total: ${progress.documents}`)
}

async function main () {
  const vectorStore = createVectorStore()
  const isFresh = process.argv[2] === '--fresh'

  if (isFresh) {
    logger.info('--fresh flag detected: wiping and re-creating collection')
    await vectorStore.deleteCollection()
  }

  await vectorStore.ensureCollection()

  const allFiles = await getAllFiles()
  logger.info(`Found ${allFiles.length} JSON files to ingest`)

  const { batchSize } = aiConfig.ingestion
  const progress = { files: 0, documents: 0, errors: 0 }
  const buffer = []

  for (const filePath of allFiles) {
    let record
    try {
      record = await fse.readJson(filePath)
    } catch (err) {
      logger.warn(`Skipping ${filePath}: ${err.message}`)
      progress.errors++
      continue
    }

    let docs
    try {
      docs = prepareDocuments(record)
    } catch (err) {
      logger.warn(`prepareDocuments failed for ${filePath}: ${err.message}`)
      progress.errors++
      continue
    }

    if (!docs || docs.length === 0) {
      progress.files++
      continue
    }

    buffer.push(...docs)
    progress.files++

    while (buffer.length >= batchSize) {
      const batch = buffer.splice(0, batchSize)
      await flushBatch(vectorStore, batch, progress)
    }
  }

  // Final flush for remaining docs
  if (buffer.length > 0) {
    await flushBatch(vectorStore, buffer, progress)
  }

  logger.info(`Ingestion complete. Total documents: ${progress.documents}`)
  logger.info(`Files processed: ${progress.files} | Errors: ${progress.errors}`)

  const stats = await vectorStore.getStats()
  logger.info(`Collection stats: ${JSON.stringify(stats)}`)
}

main().catch(function (err) {
  logger.error(`Ingestion failed: ${err.message}`)
  process.exit(1)
})

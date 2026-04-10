const { QdrantClient } = require('@qdrant/js-client-rest')
const { chunk, map } = require('lodash')
const aiConfig = require('./config')
const logger = require('../logger')

/**
 * Stable hash of a string to a non-negative integer.
 * Uses Java-style djb2-variant, matches spec requirement.
 *
 * @param {string} str
 * @returns {number}
 */
function hashStringToInt (str) {
  const raw = str.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0)
  return Math.abs(raw)
}

/**
 * Factory that creates a Qdrant vector store wrapper.
 *
 * @returns {{ ensureCollection, upsert, search, getStats, deleteCollection }}
 */
function createVectorStore () {
  const clientOptions = {
    url: aiConfig.qdrant.url
  }
  if (aiConfig.qdrant.apiKey) {
    clientOptions.apiKey = aiConfig.qdrant.apiKey
  }

  const client = new QdrantClient(clientOptions)
  const collectionName = aiConfig.qdrant.collectionName

  /**
   * Creates the Qdrant collection and payload indexes if they do not already exist.
   */
  async function ensureCollection () {
    let exists = false
    try {
      await client.getCollection(collectionName)
      exists = true
    } catch (err) {
      // getCollection throws when collection is not found
      exists = false
    }

    if (!exists) {
      logger.info(`Creating collection "${collectionName}"`)
      await client.createCollection(collectionName, {
        vectors: {
          size: aiConfig.qdrant.vectorSize,
          distance: aiConfig.qdrant.distance
        }
      })

      await client.createPayloadIndex(collectionName, {
        field_name: 'type',
        field_schema: 'keyword'
      })

      await client.createPayloadIndex(collectionName, {
        field_name: 'topicId',
        field_schema: 'keyword'
      })

      logger.info(`Collection "${collectionName}" created with payload indexes`)
    } else {
      logger.info(`Collection "${collectionName}" already exists`)
    }
  }

  /**
   * Upserts documents (with embeddings) into Qdrant in batches.
   *
   * @param {{ text: string, metadata: object, embedding: number[] }[]} documents
   */
  async function upsert (documents) {
    const batches = chunk(documents, aiConfig.ingestion.upsertBatch)
    const total = batches.length

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]

      const points = map(batch, (doc, localIndex) => {
        const globalIndex = i * aiConfig.ingestion.upsertBatch + localIndex
        const idStr = `${doc.metadata.type}-${doc.metadata.id || Date.now()}-${globalIndex}`
        const id = hashStringToInt(idStr)

        return {
          id,
          vector: doc.embedding,
          payload: {
            text: doc.text,
            ...doc.metadata
          }
        }
      })

      await client.upsert(collectionName, {
        wait: true,
        points
      })

      logger.info(`Upserted batch ${i + 1}/${total}`)
    }
  }

  /**
   * Searches the collection for similar vectors.
   *
   * @param {number[]} queryVector
   * @param {number} [topK]
   * @param {object} [filter]
   * @returns {Promise<{ score: number, payload: object }[]>}
   */
  async function search (queryVector, topK, filter) {
    const limit = topK || aiConfig.retrieval.topK
    const scoreThreshold = aiConfig.retrieval.scoreThreshold

    const searchParams = {
      vector: queryVector,
      limit,
      score_threshold: scoreThreshold,
      with_payload: true
    }

    if (filter) {
      searchParams.filter = filter
    }

    const results = await client.search(collectionName, searchParams)

    return map(results, result => ({
      score: result.score,
      payload: result.payload
    }))
  }

  /**
   * Returns basic stats about the collection.
   *
   * @returns {Promise<{ pointsCount: number, status: string }>}
   */
  async function getStats () {
    const info = await client.getCollection(collectionName)
    return {
      pointsCount: info.points_count,
      status: info.status
    }
  }

  /**
   * Deletes the collection entirely (for re-ingestion).
   */
  async function deleteCollection () {
    try {
      await client.deleteCollection(collectionName)
      logger.info(`Collection "${collectionName}" deleted`)
    } catch (err) {
      logger.info(`deleteCollection: collection "${collectionName}" may not exist — ${err.message}`)
    }
  }

  return {
    ensureCollection,
    upsert,
    search,
    getStats,
    deleteCollection
  }
}

module.exports = {
  createVectorStore
}

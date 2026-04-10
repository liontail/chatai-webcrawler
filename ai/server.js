require('dotenv').config()

const express = require('express')
const path = require('path')
const { get } = require('lodash')
const { createChatbot } = require('./chatbot')
const { createVectorStore } = require('./vectorStore')
const aiConfig = require('./config')
const logger = require('../logger')

const app = express()
const port = process.env.PORT || 3000

app.use(express.json())

app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

app.options('*', function (req, res) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.sendStatus(200)
})

app.use(express.static(path.join(__dirname, 'public')))

const chatbot = createChatbot()
const vectorStore = createVectorStore()

app.post('/chat', async function (req, res, next) {
  try {
    const query = get(req, 'body.query', '')
    const history = get(req, 'body.history', [])

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: 'query is required and must be a non-empty string' })
    }

    const result = await chatbot.chat(query.trim(), history)

    return res.json({
      answer: result.answer,
      sources: result.sources,
      images: result.images,
      imageCount: result.images.length,
      retrievedChunks: result.retrievedChunks,
      query: query.trim()
    })
  } catch (err) {
    next(err)
  }
})

app.get('/health', function (req, res) {
  res.json({
    status: 'ok',
    collection: aiConfig.qdrant.collectionName,
    timestamp: new Date().toISOString()
  })
})

app.get('/stats', async function (req, res, next) {
  try {
    const stats = await vectorStore.getStats()
    res.json(stats)
  } catch (err) {
    next(err)
  }
})

app.use(function (err, req, res, next) {
  logger.error(`Unhandled error: ${err.message}`)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

app.listen(port, function () {
  logger.info(`Chatbot server running on http://localhost:${port}`)
})

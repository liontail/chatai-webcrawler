require('dotenv').config()

module.exports = {
  openai: {
    apiKey: process.env.BEARER_TOKEN,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    embeddingModel: 'text-embedding-3-small', // 1536 dimensions, cheap + fast
    chatModel: 'gpt-4o-mini', // fast + cost-effective
    maxTokens: 2048
  },
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY || null,
    collectionName: 'ragnarok-classic-ggt',
    vectorSize: 1536, // matches text-embedding-3-small
    distance: 'Cosine'
  },
  ingestion: {
    outputDir: './output',
    chunkSize: 512, // max tokens per chunk (approx chars / 4)
    chunkOverlap: 64, // overlap tokens between chunks
    batchSize: 50, // embeddings per API batch
    upsertBatch: 100 // Qdrant upsert batch size
  },
  retrieval: {
    topK: 12, // top results to retrieve (higher = more context, covers multi-section topics)
    scoreThreshold: 0.2 // minimum similarity score (lowered to catch cross-section matches)
  }
}

import { GoogleAuth } from 'google-auth-library';

const DEFAULT_MODEL = 'gemini-embedding-001';
const DEFAULT_LOCATION = 'us-central1';
export const EMBEDDING_DIMENSIONS = 768;
const REQUEST_CONCURRENCY = 6;

function embeddingError(message, cause) {
  const error = new Error(message);
  error.cause = cause;
  return error;
}

export function createVertexEmbedder({
  projectId = process.env.FIREBASE_PROJECT_ID,
  location = process.env.VERTEX_EMBEDDING_LOCATION || DEFAULT_LOCATION,
  model = process.env.VERTEX_EMBEDDING_MODEL || DEFAULT_MODEL,
  auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }),
} = {}) {
  if (!projectId) return null;
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

  async function request(texts, taskType) {
    if (!Array.isArray(texts) || !texts.length) return [];
    let client;
    try {
      client = await auth.getClient();
    } catch (cause) {
      throw embeddingError('Semantic retrieval is temporarily unavailable', cause);
    }
    const output = [];
    // gemini-embedding-001 accepts one input per prediction request. Run a
    // small number concurrently so initial corpus indexing stays responsive.
    for (let offset = 0; offset < texts.length; offset += REQUEST_CONCURRENCY) {
      const batch = texts.slice(offset, offset + REQUEST_CONCURRENCY);
      const vectors = await Promise.all(batch.map(async content => {
        let response;
        try {
          response = await client.request({
            url: endpoint,
            method: 'POST',
            data: {
              instances: [{ content: String(content).slice(0, 8_000), task_type: taskType }],
              parameters: { autoTruncate: true, outputDimensionality: EMBEDDING_DIMENSIONS },
            },
            timeout: 30_000,
          });
        } catch (cause) {
          throw embeddingError('Semantic retrieval is temporarily unavailable', cause);
        }
        const predictions = response?.data?.predictions;
        if (!Array.isArray(predictions) || predictions.length !== 1) {
          throw embeddingError('Embedding service returned an incomplete response');
        }
        const prediction = predictions[0];
        const values = prediction?.embeddings?.values || prediction?.values;
        if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS || values.some(value => !Number.isFinite(value))) {
          throw embeddingError('Embedding service returned an invalid vector');
        }
        return values;
      }));
      output.push(...vectors);
    }
    return output;
  }

  return {
    model,
    dimensions: EMBEDDING_DIMENSIONS,
    embedDocuments: texts => request(texts, 'RETRIEVAL_DOCUMENT'),
    embedQuery: async text => (await request([text], 'RETRIEVAL_QUERY'))[0],
  };
}

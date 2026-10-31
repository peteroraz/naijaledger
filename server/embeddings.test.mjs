import test from 'node:test';
import assert from 'node:assert/strict';
import { createVertexEmbedder, EMBEDDING_DIMENSIONS } from './embeddings.mjs';

test('Vertex embedder sends one input per gemini-embedding-001 request and preserves order', async () => {
  const calls = [];
  const auth = {
    getClient: async () => ({
      request: async request => {
        assert.equal(request.data.instances.length, 1);
        const instance = request.data.instances[0];
        calls.push(instance);
        const marker = Number(instance.content.split('-').at(-1)) || 0;
        return { data: { predictions: [{ embeddings: { values: Array(EMBEDDING_DIMENSIONS).fill(marker) } }] } };
      },
    }),
  };
  const embedder = createVertexEmbedder({ projectId: 'test-project', auth });
  const documents = await embedder.embedDocuments(['record-1', 'record-2', 'record-3']);
  const query = await embedder.embedQuery('query-4');

  assert.equal(calls.length, 4);
  assert.deepEqual(calls.slice(0, 3).map(call => call.task_type), Array(3).fill('RETRIEVAL_DOCUMENT'));
  assert.equal(calls[3].task_type, 'RETRIEVAL_QUERY');
  assert.deepEqual(documents.map(vector => vector[0]), [1, 2, 3]);
  assert.equal(query[0], 4);
});

import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

const docId = value => createHash('sha256').update(value).digest('hex');

export function createFirestoreRagIndex(db) {
  const workspace = uid => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Invalid user ID');
    return db.collection('users').doc(uid).collection('workspaces').doc('default');
  };
  const chunks = uid => workspace(uid).collection('ragChunks');
  const metadata = uid => workspace(uid).collection('ragIndexes').doc('current');

  async function commitOperations(operations) {
    for (let offset = 0; offset < operations.length; offset += 400) {
      const batch = db.batch();
      for (const operation of operations.slice(offset, offset + 400)) operation(batch);
      await batch.commit();
    }
  }

  return {
    async fingerprint(uid) {
      const snapshot = await metadata(uid).get();
      return snapshot.exists ? snapshot.data()?.fingerprint || null : null;
    },

    async replace(uid, fingerprint, sourceChunks, embeddings, embeddingModel) {
      if (sourceChunks.length !== embeddings.length) throw new Error('RAG chunk and embedding counts differ');
      const collection = chunks(uid);
      const existing = await collection.get();
      const operations = existing.docs.map(snapshot => batch => batch.delete(snapshot.ref));
      sourceChunks.forEach((chunk, index) => {
        const ref = collection.doc(docId(chunk.id));
        operations.push(batch => batch.set(ref, {
          ...chunk,
          embedding: FieldValue.vector(embeddings[index]),
          indexedAt: new Date().toISOString(),
        }));
      });
      await commitOperations(operations);
      await metadata(uid).set({
        fingerprint,
        chunkCount: sourceChunks.length,
        embeddingModel,
        updatedAt: new Date().toISOString(),
      });
    },

    async search(uid, queryEmbedding, limit = 12) {
      const result = await chunks(uid).findNearest({
        vectorField: 'embedding',
        queryVector: queryEmbedding,
        limit: Math.max(1, Math.min(20, limit)),
        distanceMeasure: 'COSINE',
        distanceResultField: '_vectorDistance',
      }).get();
      return result.docs.map(snapshot => {
        const value = snapshot.data();
        delete value.embedding;
        return value;
      });
    },
  };
}

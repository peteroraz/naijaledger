import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.mjs';
import { createFirestoreStore } from './store.mjs';
import { evidenceFor, investigateWithMeta } from './meta.mjs';

function fakeFirestore() {
  const docs = new Map();
  const ref = path => ({
    collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`),
    get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }),
    create: async data => { if (docs.has(path)) { const error = new Error('exists'); error.code = 6; throw error; } docs.set(path, structuredClone(data)); },
    path,
  });
  return {
    collection: name => ref(name),
    runTransaction: async fn => {
      const pending = [];
      const result = await fn({ get: doc => doc.get(), set: (doc, value) => pending.push([doc.path, structuredClone(value)]) });
      pending.forEach(([path, value]) => docs.set(path, value));
      return result;
    },
  };
}

async function serve(store, investigate) {
  const app = createApp({ store, investigate, verifyToken: async token => {
    if (!['alice', 'bob'].includes(token)) throw new Error('Invalid token');
    return token;
  } });
  const server = app.listen(0);
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('auth, user isolation, persistence across server restarts, and stale writes', async () => {
  const db = fakeFirestore();
  const store = createFirestoreStore(db);
  let { server, url } = await serve(store, async () => { throw new Error('Model not used'); });
  const request = async (user, path, body) => {
    const response = await fetch(`${url}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await request(null, '/workspace')).status, 401);
    assert.equal((await request('forged', '/workspace')).status, 401);
    const aliceResponse = await request('alice', '/workspace');
    assert.equal(aliceResponse.status, 200, JSON.stringify(aliceResponse.data));
    const alice = aliceResponse.data;
    assert.equal(alice.invoices.length, 6);
    const approved = await request('alice', '/approvals', { invoiceId: 'INV-001', bankId: 'BNK-001', version: alice.version });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.matches.length, 1);
    const stale = await request('alice', '/approvals', { invoiceId: 'INV-004', bankId: 'BNK-002', version: alice.version });
    assert.equal(stale.status, 409);
    assert.equal((await request('bob', '/workspace')).data.matches.length, 0);
    const pack = await request('alice', '/handover');
    assert.equal(pack.status, 200);
    assert.equal(pack.data.audit.at(-1).action, 'approved');
    assert.equal(pack.data.matches.length, 1);
    await new Promise(resolve => server.close(resolve));
    ({ server, url } = await serve(createFirestoreStore(db), async () => { throw new Error('Model not used'); }));
    assert.equal((await request('alice', '/workspace')).data.matches.length, 1);
    assert.equal((await request('bob', '/workspace')).data.matches.length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('structured Meta brief cites only supplied bank records and cannot approve a match', async () => {
  const state = await createFirestoreStore(fakeFirestore()).get('alice');
  const evidence = evidenceFor(state, 'INV-004');
  const brief = await investigateWithMeta(evidence, {
    apiKey: 'test-only',
    fetcher: async (_url, init) => {
      const request = JSON.parse(init.body);
      assert.equal(request.model, 'muse-spark-1.3');
      assert.equal(request.response_format.type, 'json_schema');
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        summary: 'Check the deduction.',
        hypotheses: [{ explanation: 'A bank fee may explain it.', evidenceIds: [evidence.candidates[0].id, 'INVENTED-999'], nextStep: 'Inspect POS settlement report.', confidence: 'high' }],
        missingEvidence: ['POS settlement report'],
      }) } }] }) };
    },
  });
  assert.deepEqual(brief.hypotheses[0].evidenceIds, [evidence.candidates[0].id]);
  assert.equal(brief.hypotheses[0].confidence, 'low');
  assert.equal(brief.status, 'unverified');
  assert.equal(brief.sourceFingerprint, evidence.sourceFingerprint);
});

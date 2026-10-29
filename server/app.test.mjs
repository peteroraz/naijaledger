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

async function serve(store, investigate, extractIntake) {
  const app = createApp({ store, investigate, ...(extractIntake ? { extractIntake } : {}), verifyToken: async token => {
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

test('multisource extraction stays draft-only until reviewed rows are committed', async () => {
  const store = createFirestoreStore(fakeFirestore());
  const draft = {
    id: 'intake-test', createdAt: '2026-10-29T12:00:00.000Z', model: 'muse-spark-1.3', voiceModel: 'muse-voice-transcribe-1.0',
    sourceFingerprint: 'a'.repeat(64), status: 'awaiting_human_review',
    sources: [{ id: 'source-1', name: 'daybook.jpg', type: 'image', mimeType: 'image/jpeg', sha256: 'b'.repeat(64), size: 10, status: 'extracted', entryCount: 1 }],
    candidates: [{
      draftId: 'source-1-1', invoiceId: 'DAY-001', date: '2026-10-29', customer: 'Amina Stores', amountKobo: 4250000,
      description: 'Daybook sale', confidence: 'medium', sourceId: 'source-1', sourceLabel: 'daybook.jpg', sourceType: 'image',
      sourceHash: 'b'.repeat(64), sourceLocator: 'row 1', warnings: [], extractionModel: 'muse-spark-1.3',
    }],
  };
  const { server, url } = await serve(store, async () => { throw new Error('Not used'); }, async files => {
    assert.equal(files.length, 1);
    assert.equal(files[0].originalname, 'daybook.jpg');
    return structuredClone(draft);
  });
  try {
    const initial = await (await fetch(`${url}/api/workspace`, { headers: { Authorization: 'Bearer alice' } })).json();
    const form = new FormData();
    form.append('version', String(initial.version));
    form.append('text', '');
    form.append('files', new Blob([Buffer.from('fake image')], { type: 'image/jpeg' }), 'daybook.jpg');
    const extractedResponse = await fetch(`${url}/api/intake/extract`, { method: 'POST', headers: { Authorization: 'Bearer alice' }, body: form });
    assert.equal(extractedResponse.status, 200);
    const extracted = await extractedResponse.json();
    assert.equal(extracted.invoices.length, 6, 'draft extraction must not alter the ledger');
    assert.equal(extracted.intakeDraft.candidates.length, 1);
    assert.equal(extracted.audit.at(-1).action, 'intake-extracted');

    const candidate = { ...extracted.intakeDraft.candidates[0], customer: 'Amina Stores Ltd' };
    const committedResponse = await fetch(`${url}/api/intake/commit`, {
      method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: extracted.intakeDraft.id, rows: [candidate], version: extracted.version }),
    });
    assert.equal(committedResponse.status, 200);
    const committed = await committedResponse.json();
    assert.equal(committed.invoices.length, 7);
    assert.equal(committed.invoices.at(-1).customer, 'Amina Stores Ltd');
    assert.equal(committed.invoices.at(-1).sourceName, 'daybook.jpg');
    assert.equal(committed.invoices.at(-1).sourceHash, 'b'.repeat(64));
    assert.equal(committed.intakeDraft, null);
    assert.equal(committed.audit.at(-1).action, 'intake-committed');
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
      assert.equal(request.reasoning_effort, 'minimal');
      assert.equal(request.response_format.json_schema.name, 'naijaledger_evidence_brief');
      assert.equal(request.max_completion_tokens, 2400);
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
  assert.equal(brief.verification.status, 'human_review_required');
  assert.equal(brief.verification.checks.find(check => check.id === 'citations').passed, false);
  assert.equal(brief.verification.modelReview.verdict, 'skipped');
});

test('independent Muse review produces a persisted-ready verification receipt', async () => {
  const state = await createFirestoreStore(fakeFirestore()).get('alice');
  const evidence = evidenceFor(state, 'INV-002');
  let calls = 0;
  const brief = await investigateWithMeta(evidence, {
    apiKey: 'test-only',
    fetcher: async (_url, init) => {
      calls += 1;
      const request = JSON.parse(init.body);
      const name = request.response_format.json_schema.name;
      const content = name === 'naijaledger_evidence_brief' ? {
        summary: 'BNK-004 may be a net settlement related to this invoice.',
        hypotheses: [{ explanation: 'The NGN 78,800 credit is NGN 1,200 below INV-002.', evidenceIds: ['INV-002', 'BNK-004'], nextStep: 'Inspect the POS settlement report.', confidence: 'medium' }],
        missingEvidence: ['POS settlement report'],
      } : {
        verdict: 'supported', checkedClaims: 3, issues: [],
      };
      assert.ok(['naijaledger_evidence_brief', 'naijaledger_groundedness_review'].includes(name));
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(brief.hypotheses[0].evidenceIds, ['INV-002', 'BNK-004']);
  assert.equal(brief.verification.status, 'checks_passed');
  assert.ok(brief.verification.checks.every(check => check.passed));
  assert.equal(brief.verification.modelReview.verdict, 'supported');
  assert.equal(brief.verification.modelReview.checkedClaims, 3);
  assert.deepEqual(brief.verification.humanReview, { status: 'pending' });
});

test('empty Meta output returns a safe actionable error', async () => {
  const state = await createFirestoreStore(fakeFirestore()).get('alice');
  const evidence = evidenceFor(state, 'INV-002');
  await assert.rejects(
    investigateWithMeta(evidence, {
      apiKey: 'test-only',
      fetcher: async () => ({ ok: true, json: async () => ({
        choices: [{ finish_reason: 'length', message: { content: null } }],
      }) }),
    }),
    error => error.status === 502 && /output limit/.test(error.message),
  );
});

test('human evidence-brief sign-off is versioned and retained in the audit trail', async () => {
  const db = fakeFirestore();
  const store = createFirestoreStore(db);
  const original = await store.get('alice');
  const evidence = evidenceFor(original, 'INV-002');
  const generated = {
    summary: 'Possible net settlement.', hypotheses: [], missingEvidence: [],
    model: 'muse-spark-1.3', status: 'unverified', sourceFingerprint: evidence.sourceFingerprint,
    createdAt: new Date().toISOString(),
    verification: { status: 'checks_passed', checks: [], modelReview: { verdict: 'supported', issues: [], checkedClaims: 1 }, attempts: { generation: 1, verifier: 1, maximum: 3 }, humanReview: { status: 'pending' } },
  };
  await store.saveBrief('alice', original.version, 'INV-002', generated);
  const reviewed = await store.reviewBrief('alice', original.version, 'INV-002', evidence.sourceFingerprint);
  assert.equal(reviewed.version, original.version + 1);
  assert.equal(reviewed.briefs['INV-002'].verification.humanReview.status, 'reviewed');
  assert.equal(reviewed.audit.at(-1).action, 'brief-reviewed');
  await assert.rejects(
    store.reviewBrief('alice', original.version, 'INV-002', evidence.sourceFingerprint),
    error => error.status === 409,
  );
});

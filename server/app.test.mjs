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

async function serve(store, investigate, extractIntake, ragAgent) {
  const app = createApp({ store, investigate, ...(extractIntake ? { extractIntake } : {}), ...(ragAgent ? { ragAgent } : {}), verifyToken: async token => {
    if (token === 'judge') return { uid: 'judge', displayName: 'Judge Demo reviewer', isAnonymous: true };
    if (!['alice', 'bob'].includes(token)) throw new Error('Invalid token');
    return { uid: token, displayName: `${token[0].toUpperCase()}${token.slice(1)} Reviewer`, email: `${token}@example.com`, isAnonymous: false };
  } });
  const server = app.listen(0);
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('Judge Demo is isolated, bounded, resettable, and cannot refresh model allowances', async () => {
  const store = createFirestoreStore(fakeFirestore());
  const modelBrief = evidence => ({
    summary: 'The closest supplied row may be a net settlement and still needs human verification.',
    hypotheses: [], missingEvidence: ['Remittance advice'], model: 'muse-spark-1.3', status: 'unverified',
    sourceFingerprint: evidence.sourceFingerprint, createdAt: new Date().toISOString(),
    verification: {
      status: 'checks_passed', checks: [],
      modelReview: { model: 'muse-spark-1.3', verdict: 'supported', checkedClaims: 1, issues: [] },
      attempts: { generation: 1, verifier: 1, maximum: 3 }, humanReview: { status: 'pending' },
    },
  });
  const { server, url } = await serve(store, async evidence => modelBrief(evidence));
  const request = async (user, path, body) => {
    const response = await fetch(`${url}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${user}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const initial = await request('judge', '/workspace');
    assert.equal(initial.status, 200);
    assert.equal(initial.data.demo.isDemo, true);
    assert.deepEqual(initial.data.demo.limits, { intake: 3, investigate: 5, agent: 3 });
    assert.deepEqual(initial.data.demo.usage, { intake: 0, investigate: 0, agent: 0 });

    const approved = await request('judge', '/approvals', { invoiceId: 'INV-001', bankId: 'BNK-001', version: initial.data.version });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.matches.length, 1);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const investigated = await request('judge', '/investigate', { invoiceId: 'INV-002', version: approved.data.version });
      assert.equal(investigated.status, 200, JSON.stringify(investigated.data));
      assert.equal(investigated.data.workspace.demo.usage.investigate, attempt);
    }
    const limited = await request('judge', '/investigate', { invoiceId: 'INV-002', version: approved.data.version });
    assert.equal(limited.status, 429);
    assert.match(limited.data.error, /Demo limit reached/);

    const reset = await request('judge', '/demo/reset', { version: approved.data.version });
    assert.equal(reset.status, 200);
    assert.equal(reset.data.invoices.length, 6);
    assert.equal(reset.data.matches.length, 0);
    assert.equal(reset.data.audit.at(-1).action, 'demo-reset');
    assert.equal(reset.data.demo.usage.investigate, 5, 'reset must preserve the model allowance');
    assert.equal((await request('alice', '/demo/reset', { version: 0 })).status, 403);
    assert.equal((await request('alice', '/workspace')).data.demo.isDemo, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

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

test('Evidence Agent answers are source-bound, persistent, reviewable, and isolated by user', async () => {
  const store = createFirestoreStore(fakeFirestore());
  const createdAt = '2026-10-31T12:00:00.000Z';
  const fingerprint = 'c'.repeat(64);
  const ragAgent = {
    answer: async ({ uid, state, question }) => {
      assert.equal(uid, 'alice');
      assert.equal(state.invoices[1].id, 'INV-002');
      assert.match(question, /INV-002/);
      return {
        question, finding: 'INV-002 remains unresolved and BNK-004 is the closest retrieved credit.',
        evidence: [{ sourceId: 'invoice:INV-002', statement: 'The invoice is NGN 80,000.', type: 'invoice', title: 'INV-002', locator: 'source row 3', sourceHash: 'd'.repeat(64) }],
        calculation: 'NGN 80,000 - NGN 78,800 = NGN 1,200', confidence: 'medium',
        missingEvidence: ['POS settlement report'], nextCheck: 'Check the settlement report.',
        decisionBoundary: 'A human must approve any match.', model: 'muse-spark-1.3', createdAt, sourceFingerprint: fingerprint,
        retrieval: { mode: 'structured-evidence', chunksConsidered: 40, selectedCount: 8, evidence: [{ id: 'invoice:INV-002', type: 'invoice', title: 'INV-002', label: 'Invoice INV-002', locator: 'source row 3', verificationStatus: 'source_record', retrievalReason: 'exact source ID', retrievalScore: 0.1 }] },
        verification: { status: 'checks_passed', checkedAt: createdAt, checks: [{ id: 'citations', label: 'Citation integrity', passed: true, detail: '1 cited source checked.' }], modelReview: { model: 'muse-spark-1.3', verdict: 'supported', checkedClaims: 2, issues: [] }, humanReview: { status: 'pending' } },
      };
    },
  };
  const { server, url } = await serve(store, async () => { throw new Error('Not used'); }, undefined, ragAgent);
  const request = async (user, path, body) => {
    const response = await fetch(`${url}/api${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${user}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const initial = await request('alice', '/workspace');
    const generated = await request('alice', '/agent/query', { question: 'Why is INV-002 unresolved?', version: initial.data.version });
    assert.equal(generated.status, 200, JSON.stringify(generated.data));
    assert.equal(generated.data.answer.retrieval.mode, 'structured-evidence');
    assert.equal(generated.data.workspace.agentAnswers.length, 1);
    assert.equal(generated.data.workspace.audit.at(-1).action, 'rag-asked');
    assert.equal((await request('bob', '/workspace')).data.agentAnswers.length, 0);

    const reviewed = await request('alice', '/agent/reviews', { sourceFingerprint: fingerprint, createdAt, version: generated.data.workspace.version });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
    assert.equal(reviewed.data.agentAnswers[0].verification.humanReview.status, 'reviewed');
    assert.equal(reviewed.data.audit.at(-1).action, 'rag-reviewed');
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

test('cash lodgements, stock counts, and completed review history are versioned end to end', async () => {
  const store = createFirestoreStore(fakeFirestore());
  const { server, url } = await serve(store, async () => { throw new Error('Model not used'); });
  const request = async (path, body) => {
    const response = await fetch(`${url}/api${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const initial = (await request('/workspace')).data;
    assert.deepEqual(initial.cashReview.proposals.map(row => row.bankId), ['BNK-008', 'BNK-009']);
    assert.equal(initial.stockReview.summary.varianceItems, 2);
    const replacement = await request('/import/bank', { csv: 'id,date,description,amount\nNEW-001,2026-11-01,New period credit,100.00', version: initial.version });
    assert.equal(replacement.status, 409);
    assert.match(replacement.data.error, /Complete the current review/);

    const cash = await request('/cash-deposits', { cashEntryIds: ['CASH-001', 'CASH-002'], bankId: 'BNK-008', version: initial.version });
    assert.equal(cash.status, 200, JSON.stringify(cash.data));
    assert.equal(cash.data.cashReview.matches.length, 1);
    assert.equal(cash.data.unresolvedBank.some(row => row.id === 'BNK-008'), false);

    const stockRows = cash.data.stockReview.items.map(row => ({ ...row, countedQty: row.expectedQty }));
    const stock = await request('/stock', { rows: stockRows, version: cash.data.version });
    assert.equal(stock.status, 200, JSON.stringify(stock.data));
    assert.equal(stock.data.stockReview.summary.varianceItems, 0);

    const blocked = await request('/review-cycles/complete', { title: 'October 2026 close', version: stock.data.version });
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error, /Resolve all review items first/);
    const uncommented = await request('/resolutions', { kind: 'invoice', recordId: stock.data.unresolvedInvoices[0].id, comment: ' ', version: stock.data.version });
    assert.equal(uncommented.status, 400);
    assert.match(uncommented.data.error, /review comment/i);

    let workspace = stock.data;
    while (workspace.proposals.length) {
      const proposal = workspace.proposals[0];
      const approved = await request('/approvals', { invoiceId: proposal.invoiceId, bankId: proposal.bankId, version: workspace.version });
      assert.equal(approved.status, 200, JSON.stringify(approved.data));
      workspace = approved.data;
    }
    while (workspace.cashReview.proposals.length) {
      const proposal = workspace.cashReview.proposals[0];
      const approved = await request('/cash-deposits', { cashEntryIds: proposal.cashEntryIds, bankId: proposal.bankId, version: workspace.version });
      assert.equal(approved.status, 200, JSON.stringify(approved.data));
      workspace = approved.data;
    }
    while (workspace.unresolvedInvoices.length) {
      const record = workspace.unresolvedInvoices[0];
      const resolved = await request('/resolutions', { kind: 'invoice', recordId: record.id, comment: 'Reviewed supporting sales records and approved this exception for period close.', version: workspace.version });
      assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
      workspace = resolved.data;
    }
    while (workspace.unresolvedBank.length) {
      const record = workspace.unresolvedBank[0];
      const resolved = await request('/resolutions', { kind: 'bank', recordId: record.id, comment: 'Reviewed the bank narration and source evidence; classification is documented.', version: workspace.version });
      assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
      workspace = resolved.data;
    }
    assert.equal(workspace.closeBlockers.total, 0);
    assert.ok(workspace.manualResolutions.length > 0);
    assert.equal(workspace.manualResolutions[0].reviewer.displayName, 'Alice Reviewer');
    assert.equal(workspace.audit.at(-1).actor.email, 'alice@example.com');
    assert.ok(workspace.totals.manualReviewedKobo !== 0);
    assert.equal(workspace.totals.reconciledKobo, workspace.totals.approvedKobo + workspace.cashReview.totals.bankedCashKobo);

    const completed = await request('/review-cycles/complete', { title: 'October 2026 close', version: workspace.version });
    assert.equal(completed.status, 200, JSON.stringify(completed.data));
    assert.equal(completed.data.reviewHistory.length, 1);
    assert.ok(completed.data.reviewHistory[0].results.approvedCashDeposits >= 1);
    assert.equal(completed.data.reviewHistory[0].results.manualResolutions, workspace.manualResolutions.length);
    assert.equal(completed.data.reviewHistory[0].totals.reconciledKobo, workspace.totals.reconciledKobo);
    assert.equal(completed.data.reviewHistory[0].completedBy.email, 'alice@example.com');
    assert.equal(completed.data.reviewHistory[0].audit.at(-1).action, 'exception-resolved');
    assert.equal(completed.data.invoices.length, 0);
    assert.equal(completed.data.bank.length, 0);
    assert.equal(completed.data.cashbook.length, 0);
    assert.equal(completed.data.stockReview.items.length, 0);
    assert.equal(completed.data.manualResolutions.length, 0);
    const nextPeriod = await request('/import/bank', { csv: 'id,date,description,amount\nNOV-BNK-001,2026-11-01,November opening credit,100.00', version: completed.data.version });
    assert.equal(nextPeriod.status, 200, JSON.stringify(nextPeriod.data));
    assert.equal(nextPeriod.data.bank[0].id, 'NOV-BNK-001');
    assert.equal(nextPeriod.data.reviewHistory.length, 1, 'starting a new period must preserve completed review history');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

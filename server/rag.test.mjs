import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRagChunks, createRagAgent, hasUnsafeDecisionClaim } from './rag.mjs';
import { seedWorkspace } from './store.mjs';

const generated = (question, fingerprint) => ({
  question, finding: 'Source-bound test answer.', evidence: [], calculation: '', confidence: 'low',
  missingEvidence: [], nextCheck: 'Review the source.', decisionBoundary: 'Human review is required.',
  model: 'muse-spark-1.3', createdAt: '2026-10-31T12:00:00.000Z', sourceFingerprint: fingerprint,
  verification: { status: 'checks_passed', checkedAt: '2026-10-31T12:00:00.000Z', checks: [], modelReview: { model: 'muse-spark-1.3', verdict: 'supported', checkedClaims: 1, issues: [] }, humanReview: { status: 'pending' } },
});

test('RAG corpus preserves financial records, stock calculations, history, and curated policy IDs', () => {
  const state = seedWorkspace();
  state.reviewHistory = [{
    id: 'review-202609', title: 'September 2026', startedAt: '2026-09-01', completedAt: '2026-09-30',
    counts: { invoices: 4, bank: 5, cashbook: 8, stock: 3 }, results: { approvedInvoiceMatches: 2, approvedCashDeposits: 1, stockVarianceItems: 1 },
    manualResolutions: [{ kind: 'bank', recordId: 'SEP-BNK-05', amountKobo: -5_000, comment: 'Confirmed monthly bank fee.', reviewedAt: '2026-09-30T16:00:00.000Z', reviewer: { uid: 'alice', displayName: 'Alice Reviewer' } }],
  }];
  const chunks = buildRagChunks(state);
  assert.ok(chunks.some(chunk => chunk.id === 'invoice:INV-002' && chunk.text.includes('NGN 80,000.00')));
  assert.ok(chunks.some(chunk => chunk.id === 'bank:BNK-004'));
  assert.ok(chunks.some(chunk => chunk.id === 'cash:CASH-001'));
  assert.ok(chunks.some(chunk => chunk.id === 'cash-batch:daily:BNK-008'
    && chunk.cashEntryIds.join(',') === 'CASH-001,CASH-002'
    && chunk.verificationStatus === 'deterministic_proposal_unapproved'));
  assert.ok(chunks.some(chunk => chunk.type === 'stock' && chunk.text.includes('variance')));
  assert.ok(chunks.some(chunk => chunk.id === 'review:review-202609'));
  assert.ok(chunks.some(chunk => chunk.id === 'archived-resolution:review-202609:bank:SEP-BNK-05' && chunk.text.includes('monthly bank fee')));
  assert.ok(chunks.some(chunk => chunk.id === 'policy:KB-034'));
  assert.match(chunks.find(chunk => chunk.id === 'policy:KB-033').text, /does not automatically allocate/i);
  assert.match(chunks.find(chunk => chunk.id === 'policy:KB-044').text, /does not automatically create, link, or post/i);
  assert.ok(chunks.every(chunk => chunk.sourceHash));
});

test('Evidence Agent sends only a compact, accounting-aware evidence set to Muse', async () => {
  const state = seedWorkspace();
  let selected = null;
  const agent = createRagAgent({
    apiKey: 'test-only',
    generator: async (question, evidence, fingerprint) => { selected = evidence; return generated(question, fingerprint); },
  });
  const answer = await agent.answer({ uid: 'alice', state, question: 'Why is INV-002 different from BNK-004 by NGN 1,200?' });
  assert.equal(answer.retrieval.mode, 'structured-evidence');
  assert.ok(selected.length <= 10);
  assert.ok(selected.some(chunk => chunk.id === 'invoice:INV-002'));
  assert.ok(selected.some(chunk => chunk.id === 'bank:BNK-004'));
  assert.ok(selected.some(chunk => chunk.type === 'policy'));
  assert.equal('embeddingModel' in answer.retrieval, false);
});

test('Evidence Agent retrieves stock evidence by exact SKU', async () => {
  const state = seedWorkspace();
  const agent = createRagAgent({
    apiKey: 'test-only',
    generator: async (question, evidence, fingerprint) => {
      assert.ok(evidence.some(chunk => chunk.id === 'stock:RICE-50'));
      return generated(question, fingerprint);
    },
  });
  const answer = await agent.answer({ uid: 'alice', state, question: 'Explain the stock variance for RICE-50' });
  assert.equal(answer.retrieval.mode, 'structured-evidence');
  assert.ok(answer.retrieval.selectedCount > 0);
});

test('invoice-only questions inject linked bank candidates instead of generic policy-only context', async () => {
  const state = seedWorkspace();
  const agent = createRagAgent({
    apiKey: 'test-only',
    generator: async (question, evidence, fingerprint) => {
      assert.ok(evidence.some(chunk => chunk.id === 'invoice:INV-002'));
      assert.ok(evidence.some(chunk => chunk.id === 'bank:BNK-004'));
      assert.ok(evidence.filter(chunk => chunk.type === 'policy').length <= 1);
      return generated(question, fingerprint);
    },
  });
  await agent.answer({ uid: 'alice', state, question: 'Why is INV-002 unresolved, and what evidence should I check next?' });
});

test('cash-lodgement questions retrieve the proposal, its cash rows, candidate bank row, and policy without bank-row crowding', async () => {
  const state = seedWorkspace();
  const agent = createRagAgent({
    apiKey: 'test-only',
    generator: async (question, evidence, fingerprint) => {
      const batch = evidence.find(chunk => chunk.id === 'cash-batch:daily:BNK-008');
      assert.ok(batch);
      assert.ok(evidence.some(chunk => chunk.id === 'cash:CASH-001'));
      assert.ok(evidence.some(chunk => chunk.id === 'cash:CASH-002'));
      assert.ok(evidence.some(chunk => chunk.id === 'bank:BNK-008'));
      assert.ok(evidence.some(chunk => chunk.id === 'policy:KB-031'));
      assert.ok(evidence.filter(chunk => chunk.type === 'bank').length <= 3);
      assert.ok(evidence.length <= 10);
      return generated(question, fingerprint);
    },
  });
  await agent.answer({ uid: 'alice', state, question: 'Which cashbook entries support the daily cash lodgement to BNK-008?' });
});

test('broad cash-lodgement questions preserve every linked row for each selected proposal', async () => {
  const state = seedWorkspace();
  const agent = createRagAgent({
    apiKey: 'test-only',
    generator: async (question, evidence, fingerprint) => {
      assert.deepEqual(
        evidence.filter(chunk => chunk.type === 'current_cash_batch').map(chunk => chunk.id),
        ['cash-batch:daily:BNK-008', 'cash-batch:weekly:BNK-009'],
      );
      for (const id of ['CASH-001', 'CASH-002', 'CASH-003', 'CASH-004', 'CASH-005']) {
        assert.ok(evidence.some(chunk => chunk.id === `cash:${id}`), `${id} should be retrieved`);
      }
      assert.ok(evidence.some(chunk => chunk.id === 'bank:BNK-008'));
      assert.ok(evidence.some(chunk => chunk.id === 'bank:BNK-009'));
      assert.equal(evidence.filter(chunk => chunk.type === 'policy').length, 1);
      assert.equal(evidence.length, 10);
      return generated(question, fingerprint);
    },
  });
  await agent.answer({ uid: 'alice', state, question: 'Which cashbook entries are not yet supported by a bank lodgement?' });
});

test('decision boundary permits explicit human-control language and blocks automatic decisions', () => {
  assert.equal(hasUnsafeDecisionClaim('The batch is not approved. Human review is required before any reconciliation.'), false);
  assert.equal(hasUnsafeDecisionClaim('Do not post this proposal; it requires human approval.'), false);
  assert.equal(hasUnsafeDecisionClaim('The batch is automatically approved and can be posted.'), true);
  assert.equal(hasUnsafeDecisionClaim('The batch can be posted automatically.'), true);
  assert.equal(hasUnsafeDecisionClaim('The difference should be written off.'), true);
});

test('completed history is gated for active questions and retrieved for explicit history questions', async () => {
  const state = seedWorkspace();
  state.reviewHistory = [{
    id: 'review-202609', title: 'September 2026', startedAt: '2026-09-01', completedAt: '2026-09-30',
    counts: { invoices: 4, bank: 5, cashbook: 8, stock: 3 },
    results: { approvedInvoiceMatches: 2, approvedCashDeposits: 1, manualResolutions: 1, stockVarianceItems: 1 },
    manualResolutions: [{ kind: 'bank', recordId: 'SEP-BNK-05', amountKobo: -5_000, comment: 'Confirmed monthly bank fee.', reviewedAt: '2026-09-30T16:00:00.000Z', reviewer: { uid: 'alice' } }],
  }];
  let call = 0;
  const agent = createRagAgent({
    apiKey: 'test-only',
    generator: async (question, evidence, fingerprint) => {
      call += 1;
      if (call === 1) assert.equal(evidence.some(chunk => /_history$/.test(chunk.type)), false);
      if (call === 2) {
        assert.ok(evidence.some(chunk => chunk.id === 'review:review-202609'));
        assert.ok(evidence.some(chunk => chunk.id === 'archived-resolution:review-202609:bank:SEP-BNK-05'));
      }
      return generated(question, fingerprint);
    },
  });
  await agent.answer({ state, question: 'Why is INV-002 unresolved?' });
  await agent.answer({ state, question: 'What happened in the completed review history for September 2026?' });
});

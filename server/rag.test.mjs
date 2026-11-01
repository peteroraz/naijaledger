import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRagChunks, createRagAgent } from './rag.mjs';
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
  assert.ok(chunks.some(chunk => chunk.type === 'stock' && chunk.text.includes('variance')));
  assert.ok(chunks.some(chunk => chunk.id === 'review:review-202609'));
  assert.ok(chunks.some(chunk => chunk.id === 'archived-resolution:review-202609:bank:SEP-BNK-05' && chunk.text.includes('monthly bank fee')));
  assert.ok(chunks.some(chunk => chunk.id === 'policy:KB-034'));
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

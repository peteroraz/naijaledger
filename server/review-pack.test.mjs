import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { seedWorkspace } from './store.mjs';
import { buildReviewPdf, buildReviewWorkbook, createReviewPack } from './review-pack.mjs';

function reviewedState() {
  const state = seedWorkspace();
  state.version = 3;
  state.updatedAt = '2026-10-29T14:17:00.000Z';
  state.approved = [{ invoiceId: 'INV-001', bankId: 'BNK-001', reviewedAt: '2026-10-29T14:00:00.000Z', reviewedBy: 'test-user' }];
  state.cashAllocations = [{ cashEntryIds: ['CASH-001', 'CASH-002'], bankId: 'BNK-008', reviewedAt: '2026-10-29T14:02:00.000Z', reviewedBy: 'test-user', frequency: 'daily' }];
  state.briefs = {
    'INV-002': {
      summary: 'BNK-004 may be a net settlement, with a difference requiring human evidence.',
      hypotheses: [{
        explanation: 'The bank credit is NGN 1,200 below the invoice.', evidenceIds: ['INV-002', 'BNK-004'],
        nextStep: 'Inspect the POS settlement statement.', confidence: 'medium',
      }],
      missingEvidence: ['POS settlement statement'], model: 'muse-spark-1.3', status: 'unverified',
      sourceFingerprint: 'a'.repeat(64), createdAt: '2026-10-29T14:10:00.000Z',
      verification: {
        status: 'checks_passed', checkedAt: '2026-10-29T14:11:00.000Z',
        checks: [{ id: 'citations', label: 'Citation integrity', passed: true, detail: '2 cited source IDs checked.' }],
        modelReview: { model: 'muse-spark-1.3', verdict: 'supported', checkedClaims: 4, issues: [] },
        attempts: { generation: 2, verifier: 1, maximum: 3 },
        humanReview: { status: 'reviewed', reviewedAt: '2026-10-29T14:15:00.000Z', reviewedBy: 'test-user' },
      },
    },
  };
  state.agentAnswers = [{
    question: 'Why is INV-002 unresolved?', finding: 'The closest bank credit is NGN 1,200 below the invoice.',
    evidence: [{ sourceId: 'invoice:INV-002', statement: 'INV-002 is NGN 80,000.', title: 'INV-002', locator: 'source row 3' }],
    calculation: 'NGN 80,000 - NGN 78,800 = NGN 1,200', confidence: 'medium', missingEvidence: ['POS settlement statement'],
    nextCheck: 'Inspect the POS settlement statement.', decisionBoundary: 'Human approval is required.', model: 'muse-spark-1.3',
    createdAt: '2026-10-29T14:12:00.000Z', sourceFingerprint: 'c'.repeat(64),
    retrieval: { mode: 'hybrid-vector', chunksConsidered: 42, selectedCount: 8, evidence: [{ id: 'invoice:INV-002', type: 'invoice', locator: 'source row 3', retrievalReason: 'exact source ID' }] },
    verification: { status: 'checks_passed', checkedAt: '2026-10-29T14:13:00.000Z', checks: [{ id: 'citations', label: 'Citation integrity', passed: true, detail: '1 citation checked.' }], modelReview: { verdict: 'supported', checkedClaims: 2, issues: [] }, humanReview: { status: 'reviewed', reviewedAt: '2026-10-29T14:16:00.000Z' } },
  }];
  state.audit = [
    { action: 'approved', invoiceId: 'INV-001', bankId: 'BNK-001', by: 'test-user', at: '2026-10-29T14:00:00.000Z' },
    { action: 'brief-reviewed', invoiceId: 'INV-002', by: 'test-user', at: '2026-10-29T14:15:00.000Z', sourceFingerprint: 'a'.repeat(64) },
  ];
  return state;
}

test('review pack PDF is a complete printable document', async () => {
  const report = createReviewPack(reviewedState(), '2026-10-29T14:20:00.000Z');
  const file = await buildReviewPdf(report);
  assert.ok(Buffer.isBuffer(file));
  assert.equal(file.subarray(0, 5).toString(), '%PDF-');
  assert.ok(file.length > 5000);
});

test('review pack Excel workbook preserves source, review, verification, and audit tables', async () => {
  const report = createReviewPack(reviewedState(), '2026-10-29T14:20:00.000Z');
  const file = await buildReviewWorkbook(report);
  assert.ok(Buffer.isBuffer(file));
  assert.equal(file.subarray(0, 2).toString(), 'PK');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
    'Summary', 'Approved Matches', 'Unresolved Invoices', 'Unresolved Bank', 'Sales Invoices',
    'Bank Transactions', 'Cashbook', 'Cash Deposits', 'Stock Reconciliation', 'Review History',
    'AI Briefs', 'Evidence Agent', 'Verification Checks', 'Audit Trail',
  ]);
  assert.equal(workbook.getWorksheet('Summary').getCell('A1').value, 'NaijaLedger review pack');
  assert.equal(workbook.getWorksheet('Approved Matches').getCell('A2').value, 'INV-001');
  assert.equal(workbook.getWorksheet('Cash Deposits').getCell('A2').value, 'Approved');
  assert.equal(workbook.getWorksheet('Stock Reconciliation').getCell('A2').value, 'RICE-50');
  assert.equal(workbook.getWorksheet('AI Briefs').getCell('A2').value, 'INV-002');
  assert.match(String(workbook.getWorksheet('Evidence Agent').getCell('B2').value), /INV-002/);
  assert.equal(workbook.getWorksheet('Verification Checks').getCell('D2').value, 'Passed');
  assert.equal(workbook.getWorksheet('Audit Trail').rowCount, 3);
});

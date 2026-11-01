import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from './store.mjs';
import { reconcile } from './reconcile.mjs';
import { reconcileCashbook, reconcileStock, reviewCycleSnapshot } from './operations.mjs';

test('daily and weekly cash takings create exact, human-reviewable bank lodgement proposals', () => {
  const state = seedWorkspace();
  const invoices = reconcile(state.invoices, state.bank, []);
  const result = reconcileCashbook(state.cashbook, state.bank, [], invoices.proposals.map(row => row.bankId));
  assert.deepEqual(result.proposals.map(row => [row.frequency, row.bankId, row.amountKobo]), [
    ['daily', 'BNK-008', 6_300_000], ['weekly', 'BNK-009', 5_100_000],
  ]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.totals.cashSalesKobo, 11_400_000);
});

test('approved cash batch is removed from proposals and a bank credit cannot be reused', () => {
  const state = seedWorkspace();
  const approved = [{ cashEntryIds: ['CASH-001', 'CASH-002'], bankId: 'BNK-008', reviewedAt: '2026-10-30T00:00:00.000Z' }];
  const result = reconcileCashbook(state.cashbook, state.bank, approved);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].amountKobo, 6_300_000);
  assert.ok(result.proposals.every(row => row.bankId !== 'BNK-008'));
  assert.throws(() => reconcileCashbook(state.cashbook, state.bank, [...approved, approved[0]]), /already allocated/);
});

test('stock reconciliation calculates expected count and signed variance', () => {
  const result = reconcileStock(seedWorkspace().stock);
  assert.equal(result.summary.totalItems, 4);
  assert.equal(result.summary.varianceItems, 2);
  assert.equal(result.items.find(row => row.sku === 'OIL-5').varianceQty, -1);
  assert.equal(result.items.find(row => row.sku === 'SOAP-CTN').status, 'surplus');
});

test('completed review snapshot keeps decision totals without copying raw source rows', () => {
  const state = seedWorkspace();
  state.approved = [{ invoiceId: 'INV-001', bankId: 'BNK-001' }];
  state.cashAllocations = [{ cashEntryIds: ['CASH-001', 'CASH-002'], bankId: 'BNK-008' }];
  state.manualResolutions = [{ kind: 'invoice', recordId: 'INV-002', amountKobo: 8_000_000, comment: 'Reviewed', reviewedAt: '2026-10-30T09:00:00.000Z', reviewer: { uid: 'alice', displayName: 'Alice Reviewer' } }];
  state.audit = [{ action: 'exception-resolved', invoiceId: 'INV-002', at: '2026-10-30T09:00:00.000Z' }];
  const snapshot = reviewCycleSnapshot(state, 'October close', '2026-10-30T10:00:00.000Z', { uid: 'alice', displayName: 'Alice Reviewer' });
  assert.equal(snapshot.counts.cashbook, 5);
  assert.equal(snapshot.totals.approvedInvoiceKobo, 12_000_000);
  assert.equal(snapshot.totals.bankedCashKobo, 6_300_000);
  assert.equal(snapshot.totals.reviewedLedgerKobo, 26_300_000);
  assert.equal(snapshot.results.manualResolutions, 1);
  assert.equal(snapshot.manualResolutions[0].comment, 'Reviewed');
  assert.equal(snapshot.audit[0].action, 'exception-resolved');
  assert.equal(snapshot.completedBy.displayName, 'Alice Reviewer');
  assert.equal('bank' in snapshot, false);
});

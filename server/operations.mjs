const sumKobo = rows => rows.reduce((total, row) => total + Number(row.amountKobo || 0), 0);

function datePlusDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekKey(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function reconcileCashbook(cashbook = [], bank = [], allocations = [], blockedBankIds = []) {
  const entries = new Map(cashbook.map(row => [row.id, row]));
  const credits = new Map(bank.filter(row => row.amountKobo > 0).map(row => [row.id, row]));
  const usedEntries = new Set();
  const usedBank = new Set(blockedBankIds);
  const matches = [];
  for (const allocation of allocations) {
    const selected = (allocation.cashEntryIds || []).map(id => entries.get(id));
    const credit = credits.get(allocation.bankId);
    if (!credit || selected.some(row => !row) || !selected.length) throw new Error('Cash allocation references missing source');
    if (usedBank.has(credit.id) || selected.some(row => usedEntries.has(row.id))) throw new Error('Cash source already allocated');
    const total = sumKobo(selected);
    if (total !== credit.amountKobo) throw new Error('Cash deposit amount does not match selected takings');
    selected.forEach(row => usedEntries.add(row.id)); usedBank.add(credit.id);
    matches.push({ ...allocation, amountKobo: total, entryCount: selected.length, startDate: selected[0].date, endDate: selected.at(-1).date });
  }

  const available = cashbook.filter(row => !usedEntries.has(row.id)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const bankAvailable = bank.filter(row => row.amountKobo > 0 && !usedBank.has(row.id));
  const groups = [];
  const daily = Map.groupBy(available, row => row.date);
  for (const [date, rows] of daily) groups.push({ frequency: 'daily', key: date, startDate: date, endDate: date, rows });
  const weekly = Map.groupBy(available, row => weekKey(row.date));
  for (const [startDate, rows] of weekly) if (new Set(rows.map(row => row.date)).size > 1) groups.push({ frequency: 'weekly', key: startDate, startDate, endDate: rows.at(-1).date, rows });

  const proposals = [];
  const claimedEntries = new Set();
  const claimedBank = new Set();
  for (const group of groups.sort((a, b) => a.frequency.localeCompare(b.frequency))) {
    if (group.rows.some(row => claimedEntries.has(row.id))) continue;
    const total = sumKobo(group.rows);
    const latestDepositDate = datePlusDays(group.endDate, group.frequency === 'daily' ? 3 : 7);
    const candidates = bankAvailable.filter(row => !claimedBank.has(row.id) && row.amountKobo === total && row.date >= group.endDate && row.date <= latestDepositDate);
    if (candidates.length !== 1) continue;
    const competingGroups = groups.filter(other => sumKobo(other.rows) === total && other.endDate <= candidates[0].date && datePlusDays(other.endDate, other.frequency === 'daily' ? 3 : 7) >= candidates[0].date);
    if (competingGroups.length !== 1) continue;
    claimedBank.add(candidates[0].id); group.rows.forEach(row => claimedEntries.add(row.id));
    proposals.push({
      cashEntryIds: group.rows.map(row => row.id), bankId: candidates[0].id, amountKobo: total,
      entryCount: group.rows.length, frequency: group.frequency, startDate: group.startDate, endDate: group.endDate,
      reason: `Exact ${group.frequency} cash total; bank credit recorded within ${group.frequency === 'daily' ? 3 : 7} days. Verify the teller, deposit slip or lodgement reference before approval.`,
    });
  }
  return {
    matches, proposals,
    unbankedCash: cashbook.filter(row => !usedEntries.has(row.id) && !claimedEntries.has(row.id)),
    totals: { cashSalesKobo: sumKobo(cashbook), bankedCashKobo: matches.reduce((total, row) => total + row.amountKobo, 0), proposedCashKobo: proposals.reduce((total, row) => total + row.amountKobo, 0) },
  };
}

export function reconcileStock(rows = []) {
  const items = rows.map(row => {
    const expectedQty = Number(row.openingQty || 0) + Number(row.receivedQty || 0) - Number(row.soldQty || 0) + Number(row.adjustmentQty || 0);
    const countedQty = Number(row.countedQty || 0);
    const varianceQty = countedQty - expectedQty;
    return { ...row, expectedQty, varianceQty, status: Math.abs(varianceQty) < 0.000001 ? 'balanced' : varianceQty > 0 ? 'surplus' : 'shortage' };
  });
  return { items, summary: { totalItems: items.length, balancedItems: items.filter(row => row.status === 'balanced').length, varianceItems: items.filter(row => row.status !== 'balanced').length } };
}

export function reviewCycleSnapshot(state, title, completedAt = new Date().toISOString(), completedBy = null) {
  const cash = reconcileCashbook(state.cashbook || [], state.bank || [], state.cashAllocations || []);
  const stock = reconcileStock(state.stock || []);
  const manualResolutions = state.manualResolutions || [];
  const manualReviewedInvoiceKobo = manualResolutions.filter(row => row.kind === 'invoice').reduce((total, row) => total + Number(row.amountKobo || 0), 0);
  const manualReviewedBankKobo = manualResolutions.filter(row => row.kind === 'bank').reduce((total, row) => total + Number(row.amountKobo || 0), 0);
  const approvedInvoiceKobo = (state.approved || []).reduce((total, allocation) => total + Number(state.invoices.find(row => row.id === allocation.invoiceId)?.amountKobo || 0), 0);
  const reviewedLedgerKobo = approvedInvoiceKobo + cash.totals.bankedCashKobo + manualReviewedInvoiceKobo + manualReviewedBankKobo;
  return {
    id: `review-${completedAt.replace(/\D/g, '').slice(0, 14)}`,
    title, startedAt: state.reviewCycle?.startedAt || state.updatedAt, completedAt, completedBy,
    sourceHashes: { ...(state.imports || {}) },
    counts: { invoices: state.invoices.length, bank: state.bank.length, cashbook: (state.cashbook || []).length, stock: stock.items.length },
    totals: {
      invoicedKobo: sumKobo(state.invoices), bankCreditsKobo: sumKobo(state.bank.filter(row => row.amountKobo > 0)),
      approvedInvoiceKobo, cashSalesKobo: cash.totals.cashSalesKobo, bankedCashKobo: cash.totals.bankedCashKobo,
      manualReviewedInvoiceKobo, manualReviewedBankKobo, reviewedLedgerKobo,
    },
    results: {
      approvedInvoiceMatches: (state.approved || []).length,
      approvedCashDeposits: (state.cashAllocations || []).length,
      manualResolutions: manualResolutions.length,
      stockVarianceItems: stock.summary.varianceItems,
    },
    manualResolutions: structuredClone(manualResolutions),
    audit: structuredClone(state.audit || []),
  };
}

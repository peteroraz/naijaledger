import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { reconcile } from './reconcile.mjs';
import { reconcileCashbook, reconcileStock } from './operations.mjs';

const GREEN = '174F3A';
const LIGHT_GREEN = 'EAF4E9';
const PALE_GREEN = 'F5F8F3';
const AMBER = 'FFF4DD';
const TEXT = '19312B';
const MUTED = '66796D';
const BORDER = 'D9E5DC';
const MONEY_FORMAT = '"NGN" #,##0.00';

const ngn = kobo => `NGN ${(Number(kobo || 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amount = kobo => Number(kobo || 0) / 100;
const dateValue = value => value ? new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value) : null;
const iso = value => value ? new Date(value).toISOString() : '';
const text = value => String(value ?? '')
  .replaceAll('₦', 'NGN ')
  .replaceAll('↔', '<->')
  .replace(/[–—]/g, '-')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
const proposalKey = proposal => proposal.cashEntryIds
  ? `cash:${proposal.bankId}:${proposal.cashEntryIds.join('+')}`
  : `invoice:${proposal.invoiceId}:${proposal.bankId}`;
const uniqueRows = rows => [...new Map(rows.map(row => [row.id, row])).values()];

export function createReviewPack(state, generatedAt = new Date().toISOString()) {
  const cashAllocations = state.cashAllocations || [];
  const manualResolutions = state.manualResolutions || [];
  const resolvedInvoiceIds = manualResolutions.filter(row => row.kind === 'invoice').map(row => row.recordId);
  const resolvedBankIds = manualResolutions.filter(row => row.kind === 'bank').map(row => row.recordId);
  const resolvedCashIds = manualResolutions.filter(row => row.kind === 'cash').map(row => row.recordId);
  const rejected = new Set((state.rejectedProposals || []).map(row => row.key));
  const rawInvoiceReview = reconcile(state.invoices, state.bank, state.approved || [], [...cashAllocations.map(row => row.bankId), ...resolvedBankIds], resolvedInvoiceIds);
  const rejectedInvoiceProposals = rawInvoiceReview.proposals.filter(row => rejected.has(proposalKey(row)));
  const invoiceReview = {
    ...rawInvoiceReview,
    proposals: rawInvoiceReview.proposals.filter(row => !rejected.has(proposalKey(row))),
    unresolvedInvoices: uniqueRows([...rawInvoiceReview.unresolvedInvoices, ...rejectedInvoiceProposals.map(proposal => state.invoices.find(row => row.id === proposal.invoiceId)).filter(Boolean)]),
    unresolvedBank: uniqueRows([...rawInvoiceReview.unresolvedBank, ...rejectedInvoiceProposals.map(proposal => state.bank.find(row => row.id === proposal.bankId)).filter(Boolean)]),
  };
  const rawCashReview = reconcileCashbook(state.cashbook || [], state.bank, cashAllocations, [...invoiceReview.matches, ...invoiceReview.proposals].map(row => row.bankId).concat(resolvedBankIds), resolvedCashIds);
  const rejectedCashProposals = rawCashReview.proposals.filter(row => rejected.has(proposalKey(row)));
  const cashReview = {
    ...rawCashReview,
    proposals: rawCashReview.proposals.filter(row => !rejected.has(proposalKey(row))),
    unbankedCash: uniqueRows([
      ...rawCashReview.unbankedCash,
      ...rejectedCashProposals.flatMap(proposal => proposal.cashEntryIds.map(id => (state.cashbook || []).find(row => row.id === id))).filter(Boolean),
    ]),
  };
  const cashBankIds = new Set([...cashReview.matches, ...cashReview.proposals].map(row => row.bankId));
  const manualReviewedInvoiceKobo = manualResolutions.filter(row => row.kind === 'invoice').reduce((total, row) => total + Number(row.amountKobo || 0), 0);
  const manualReviewedBankKobo = manualResolutions.filter(row => row.kind === 'bank').reduce((total, row) => total + Number(row.amountKobo || 0), 0);
  const manualReviewedCashKobo = manualResolutions.filter(row => row.kind === 'cash').reduce((total, row) => total + Number(row.amountKobo || 0), 0);
  const reviewHistory = state.reviewHistory || [];
  const allManualResolutions = [
    ...reviewHistory.flatMap(review => (review.manualResolutions || []).map(row => ({ ...row, reviewId: review.id, reviewTitle: review.title }))),
    ...manualResolutions.map(row => ({ ...row, reviewId: state.reviewCycle?.title || 'active', reviewTitle: state.reviewCycle?.title || 'Current review' })),
  ];
  const allAudit = [
    ...reviewHistory.flatMap(review => (review.audit || []).map(event => ({ ...event, reviewId: review.id, reviewTitle: review.title }))),
    ...(state.audit || []).map(event => ({ ...event, reviewId: state.reviewCycle?.title || 'active', reviewTitle: state.reviewCycle?.title || 'Current review' })),
  ];
  const totals = {
    ...invoiceReview.totals,
    manualReviewedInvoiceKobo,
    manualReviewedBankKobo,
    manualReviewedCashKobo,
    manualReviewedKobo: manualReviewedInvoiceKobo + manualReviewedBankKobo + manualReviewedCashKobo,
    reconciledKobo: invoiceReview.totals.approvedKobo + cashReview.totals.bankedCashKobo,
    ledgerReviewedKobo: invoiceReview.totals.approvedKobo + cashReview.totals.bankedCashKobo + manualReviewedInvoiceKobo + manualReviewedCashKobo,
  };
  return {
    title: 'NaijaLedger review pack',
    generatedAt,
    status: 'Human review required; not a tax filing or accounting certification',
    sourceHashes: state.imports,
    workspaceVersion: state.version,
    ...invoiceReview, totals,
    unresolvedBank: invoiceReview.unresolvedBank.filter(row => !cashBankIds.has(row.id)),
    invoices: state.invoices,
    bank: state.bank,
    approved: state.approved || [],
    cashbook: state.cashbook || [], cashAllocations, cashReview, manualResolutions: allManualResolutions,
    rejectedProposals: state.rejectedProposals || [],
    stockReview: reconcileStock(state.stock || []),
    reviewCycle: state.reviewCycle || null, reviewHistory,
    briefs: state.briefs || {}, agentAnswers: state.agentAnswers || [], intakeDraft: state.intakeDraft || null,
    audit: allAudit,
    updatedAt: state.updatedAt,
  };
}

const reviewerName = reviewer => reviewer?.displayName || reviewer?.email || reviewer?.uid || '';
const closureLabel = closure => closure?.status === 'closed_with_open_items' ? 'Closed with open items' : 'Fully reconciled';

function openIssueRows(report) {
  const rows = [];
  const add = (period, status, type, record, date, detail, amountKobo, nextAction = '') => rows.push({ period, status, type, record, date, detail, amount: amountKobo == null ? null : amount(amountKobo), nextAction });
  const addSet = (period, status, items = {}) => {
    for (const row of items.unresolvedInvoices || []) add(period, status, 'Unresolved invoice', row.id, row.date, row.customer || '', row.amountKobo, 'No approved bank match at close');
    for (const row of items.unresolvedBank || []) add(period, status, 'Unresolved bank entry', row.id, row.date, row.description || '', row.amountKobo, 'No approved sales or cash allocation at close');
    for (const row of items.unbankedCash || []) add(period, status, 'Unbanked cash', row.id, row.date, `${row.customer || ''}${row.description ? ` · ${row.description}` : ''}`, row.amountKobo, 'Cash receipt had no approved lodgement at close');
    for (const row of items.stockVariances || []) add(period, status, 'Stock variance', row.sku, '', `${row.item || ''} · expected ${row.expectedQty ?? ''}, counted ${row.countedQty ?? ''}`, null, `Variance ${row.varianceQty ?? 0} ${row.unit || ''}`);
    for (const row of items.invoiceProposals || []) add(period, status, 'Unapproved invoice proposal', `${row.invoiceId} <-> ${row.bankId}`, '', row.reason || '', row.amountKobo, 'Suggested match was not approved');
    for (const row of items.cashProposals || []) add(period, status, 'Unapproved cash proposal', `${(row.cashEntryIds || []).join(', ')} -> ${row.bankId}`, `${row.startDate || ''}${row.endDate && row.endDate !== row.startDate ? ` to ${row.endDate}` : ''}`, row.reason || '', row.amountKobo, 'Suggested lodgement was not approved');
    for (const row of items.pendingEvidence || []) add(period, status, 'Pending evidence checkpoint', row.reference || '', '', `${row.type || 'Evidence'} · ${row.detail || ''}`, null, 'Human checkpoint was pending at close');
  };
  addSet(report.reviewCycle?.title || 'Current review', 'Open in active review', {
    unresolvedInvoices: report.unresolvedInvoices,
    unresolvedBank: report.unresolvedBank,
    unbankedCash: report.cashReview.unbankedCash,
    stockVariances: report.stockReview.items.filter(row => row.status !== 'balanced' && !report.manualResolutions.some(resolution => resolution.kind === 'stock' && resolution.recordId === row.sku)),
    invoiceProposals: report.proposals,
    cashProposals: report.cashReview.proposals,
    pendingEvidence: [
      ...(report.intakeDraft ? [{ type: 'intake draft', reference: report.intakeDraft.id, detail: `${report.intakeDraft.candidates?.length || 0} candidate records awaiting review` }] : []),
      ...Object.entries(report.briefs || {}).filter(([, brief]) => brief.verification?.humanReview?.status !== 'reviewed').map(([invoiceId]) => ({ type: 'Meta brief', reference: invoiceId, detail: 'Human checkpoint pending' })),
      ...(report.agentAnswers || []).filter(answer => answer.verification?.humanReview?.status !== 'reviewed').map(answer => ({ type: 'Evidence Agent answer', reference: answer.createdAt, detail: answer.question })),
    ],
  });
  for (const review of report.reviewHistory || []) addSet(review.title, closureLabel(review.closure), review.closure?.openItems || {});
  return rows;
}

function reconciledRows(report) {
  const rows = [];
  const addPeriod = (period, invoices, bank, approved, cashAllocations) => {
    const invoiceById = new Map((invoices || []).map(row => [row.id, row]));
    const bankById = new Map((bank || []).map(row => [row.id, row]));
    for (const match of approved || []) {
      const invoice = invoiceById.get(match.invoiceId);
      const credit = bankById.get(match.bankId);
      rows.push({ period, type: 'Invoice match', sourceRecords: `${match.invoiceId} <-> ${match.bankId}`, party: invoice?.customer || '', amount: amount(invoice?.amountKobo || 0), reviewedAt: dateValue(match.reviewedAt), reviewer: reviewerName(match.reviewer) || match.reviewedBy || '', evidence: credit?.description || '' });
    }
    for (const allocation of cashAllocations || []) {
      const credit = bankById.get(allocation.bankId);
      rows.push({ period, type: 'Cash lodgement', sourceRecords: `${(allocation.cashEntryIds || []).join(', ')} -> ${allocation.bankId}`, party: '', amount: amount(credit?.amountKobo || 0), reviewedAt: dateValue(allocation.reviewedAt), reviewer: reviewerName(allocation.reviewer) || allocation.reviewedBy || '', evidence: credit?.description || allocation.frequency || '' });
    }
  };
  addPeriod(report.reviewCycle?.title || 'Current review', report.invoices, report.bank, report.approved, report.cashAllocations);
  for (const review of report.reviewHistory || []) addPeriod(review.title, review.invoices, review.bank, review.approved, review.cashAllocations);
  return rows;
}

function sourceRows(report) {
  const rows = [];
  const addPeriod = (period, review) => {
    for (const row of review.invoices || []) rows.push({ period, type: 'Invoice', id: row.id, date: dateValue(row.date), party: row.customer || '', description: row.description || '', amount: amount(row.amountKobo), sourceRow: row.sourceRow, sourceHash: row.sourceHash || review.sourceHashes?.invoices || '' });
    for (const row of review.bank || []) rows.push({ period, type: 'Bank', id: row.id, date: dateValue(row.date), party: '', description: row.description || '', amount: amount(row.amountKobo), sourceRow: row.sourceRow, sourceHash: review.sourceHashes?.bank || '' });
    for (const row of review.cashbook || []) rows.push({ period, type: 'Cashbook', id: row.id, date: dateValue(row.date), party: row.customer || '', description: row.description || '', amount: amount(row.amountKobo), sourceRow: row.sourceRow, sourceHash: row.sourceHash || review.sourceHashes?.cashbook || '' });
    for (const row of review.stock || []) rows.push({ period, type: 'Stock', id: row.sku, date: null, party: row.item || '', description: `${row.unit || ''} · opening ${row.openingQty}; received ${row.receivedQty}; sold ${row.soldQty}; adjustment ${row.adjustmentQty}; counted ${row.countedQty}`, amount: null, sourceRow: row.sourceRow, sourceHash: review.sourceHashes?.stock || '' });
  };
  addPeriod(report.reviewCycle?.title || 'Current review', { invoices: report.invoices, bank: report.bank, cashbook: report.cashbook, stock: report.stockReview.items, sourceHashes: report.sourceHashes });
  for (const review of report.reviewHistory || []) addPeriod(review.title, review);
  return rows;
}

function decisionRows(report) {
  const rows = [];
  const addPeriod = (period, review) => {
    for (const row of review.manualResolutions || []) rows.push({ period, type: `${row.kind} reviewed by comment`, records: row.recordId, amount: amount(row.amountKobo), decisionAt: dateValue(row.reviewedAt), reviewer: reviewerName(row.reviewer), comment: row.comment });
    for (const row of review.rejectedProposals || []) rows.push({ period, type: `${row.kind} proposal rejected`, records: row.invoiceId || (row.cashEntryIds || []).join(', '), amount: amount(row.amountKobo), decisionAt: dateValue(row.rejectedAt), reviewer: reviewerName(row.reviewer), comment: row.comment });
    if (review.closure) rows.push({ period, type: closureLabel(review.closure), records: `${review.closure.openItemCount || 0} open items`, amount: null, decisionAt: dateValue(review.completedAt), reviewer: reviewerName(review.completedBy), comment: review.closure.comment });
  };
  addPeriod(report.reviewCycle?.title || 'Current review', report);
  for (const review of report.reviewHistory || []) addPeriod(review.title, review);
  return rows;
}

function aiEvidenceRows(report) {
  const rows = [];
  const addPeriod = (period, review) => {
    for (const [invoiceId, brief] of Object.entries(review.briefs || {})) rows.push({ period, type: 'Meta evidence brief', reference: invoiceId, createdAt: dateValue(brief.createdAt), model: brief.model, status: brief.verification?.humanReview?.status || 'pending', summary: brief.summary, fingerprint: brief.sourceFingerprint });
    for (const answer of review.agentAnswers || []) rows.push({ period, type: 'Evidence Agent answer', reference: answer.question, createdAt: dateValue(answer.createdAt), model: answer.model, status: answer.verification?.humanReview?.status || 'pending', summary: answer.finding, fingerprint: answer.sourceFingerprint });
  };
  addPeriod(report.reviewCycle?.title || 'Current review', report);
  for (const review of report.reviewHistory || []) addPeriod(review.title, review);
  return rows;
}

function styleWorksheet(sheet, widths = {}) {
  sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  sheet.pageSetup = {
    orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 2, fitToHeight: 0,
    printTitlesRow: '1:1', margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  sheet.getRow(1).height = 26;
  sheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREEN}` } };
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { right: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.font = { name: 'Arial', size: 10, color: { argb: `FF${TEXT}` } };
    row.alignment = { vertical: 'top' };
    if (rowNumber % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${PALE_GREEN}` } };
    row.eachCell(cell => {
      cell.border = { bottom: { style: 'hair', color: { argb: `FF${BORDER}` } } };
    });
  });
  Object.entries(widths).forEach(([key, width]) => { sheet.getColumn(key).width = width; });
}

function addRowsSheet(workbook, name, columns, rows, widths = {}) {
  const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: `FF${GREEN}` } } });
  sheet.columns = columns;
  sheet.addRows(rows);
  styleWorksheet(sheet, widths);
  return sheet;
}

async function buildLegacyReviewWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NaijaLedger';
  workbook.company = 'NaijaLedger';
  workbook.subject = 'Sales-to-bank reconciliation review pack';
  workbook.title = report.title;
  workbook.created = new Date(report.generatedAt);
  workbook.modified = new Date(report.generatedAt);

  const summary = workbook.addWorksheet('Summary', { properties: { tabColor: { argb: `FF${GREEN}` } }, views: [{ showGridLines: false }] });
  summary.pageSetup = {
    orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1,
    margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  summary.columns = [{ key: 'label', width: 29 }, { key: 'value', width: 32 }, { key: 'label2', width: 29 }, { key: 'value2', width: 32 }];
  summary.mergeCells('A1:D1');
  summary.getCell('A1').value = 'NaijaLedger review pack';
  summary.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: `FF${GREEN}` } };
  summary.getCell('A1').alignment = { vertical: 'middle' };
  summary.getRow(1).height = 30;
  summary.mergeCells('A2:D2');
  summary.getCell('A2').value = report.status;
  summary.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${AMBER}` } };
  summary.getCell('A2').font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF7A5421' } };
  summary.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
  summary.getRow(2).height = 28;

  const summaryRows = [
    ['Generated at', dateValue(report.generatedAt), 'Workspace version', report.workspaceVersion],
    ['Workspace updated', dateValue(report.updatedAt), 'Invoices', report.invoices.length],
    ['Bank transactions', report.bank.length, 'Approved matches', report.matches.length],
    ['Unresolved invoices', report.unresolvedInvoices.length, 'Unresolved bank entries', report.unresolvedBank.length],
    ['Invoiced total', amount(report.totals.invoicedKobo), 'Bank credit total', amount(report.totals.bankCreditsKobo)],
    ['Approved invoice total', amount(report.totals.approvedKobo), 'Reconciled value', amount(report.totals.reconciledKobo)],
    ['Ledger-reviewed sales', amount(report.totals.ledgerReviewedKobo), 'Manually reviewed cash', amount(report.totals.manualReviewedCashKobo)],
    ['Comment-resolved invoices', amount(report.totals.manualReviewedInvoiceKobo), 'Comment-resolved bank entries', amount(report.totals.manualReviewedBankKobo)],
    ['Cashbook total', amount(report.cashReview.totals.cashSalesKobo), 'Approved cash lodgements', report.cashReview.matches.length],
    ['Stock items', report.stockReview.summary.totalItems, 'Stock variances', report.stockReview.summary.varianceItems],
    ['Evidence Agent answers', report.agentAnswers.length, 'Completed review history', report.reviewHistory.length],
  ];
  summary.addRows([[], ['Review summary'], ...summaryRows]);
  const sectionRow = 4;
  summary.mergeCells(`A${sectionRow}:D${sectionRow}`);
  summary.getRow(sectionRow).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREEN}` } };
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  });
  for (let row = 5; row <= 15; row += 1) {
    summary.getRow(row).font = { name: 'Arial', size: 10, color: { argb: `FF${TEXT}` } };
    summary.getCell(`A${row}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: `FF${MUTED}` } };
    summary.getCell(`C${row}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: `FF${MUTED}` } };
  }
  ['B9', 'D9', 'B10', 'D10', 'B11', 'D11', 'B12', 'D12', 'B13'].forEach(ref => { summary.getCell(ref).numFmt = MONEY_FORMAT; });
  ['B5', 'B6'].forEach(ref => { summary.getCell(ref).numFmt = 'yyyy-mm-dd hh:mm'; });
  summary.addRow([]);
  const hashHeading = summary.addRow(['Source fingerprints']);
  summary.mergeCells(`A${hashHeading.number}:D${hashHeading.number}`);
  hashHeading.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREEN}` } };
  hashHeading.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  summary.addRow(['Sales invoices SHA-256', report.sourceHashes?.invoices || 'Not available']);
  summary.mergeCells(`B${summary.rowCount}:D${summary.rowCount}`);
  summary.addRow(['Bank transactions SHA-256', report.sourceHashes?.bank || 'Not available']);
  summary.mergeCells(`B${summary.rowCount}:D${summary.rowCount}`);
  summary.addRow(['Cashbook SHA-256', report.sourceHashes?.cashbook || 'Not available']);
  summary.mergeCells(`B${summary.rowCount}:D${summary.rowCount}`);
  summary.addRow(['Stock SHA-256', report.sourceHashes?.stock || 'Not available']);
  summary.mergeCells(`B${summary.rowCount}:D${summary.rowCount}`);
  summary.getRows(hashHeading.number + 1, 4).forEach(row => {
    row.font = { name: 'Arial', size: 9, color: { argb: `FF${TEXT}` } };
    row.getCell(1).font = { name: 'Arial', size: 9, bold: true, color: { argb: `FF${MUTED}` } };
  });

  const invoiceById = new Map(report.invoices.map(row => [row.id, row]));
  const bankById = new Map(report.bank.map(row => [row.id, row]));
  addRowsSheet(workbook, 'Approved Matches', [
    { header: 'Invoice ID', key: 'invoiceId' }, { header: 'Customer', key: 'customer' },
    { header: 'Bank ID', key: 'bankId' }, { header: 'Bank description', key: 'description' },
    { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } },
    { header: 'Reviewed at', key: 'reviewedAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Reviewed by', key: 'reviewedBy' },
  ], report.matches.map(match => ({
    invoiceId: match.invoiceId, customer: invoiceById.get(match.invoiceId)?.customer || '',
    bankId: match.bankId, description: bankById.get(match.bankId)?.description || '', amount: amount(match.amountKobo),
    reviewedAt: dateValue(report.approved.find(x => x.invoiceId === match.invoiceId && x.bankId === match.bankId)?.reviewedAt),
    reviewedBy: report.approved.find(x => x.invoiceId === match.invoiceId && x.bankId === match.bankId)?.reviewedBy || '',
  })), { A: 15, B: 24, C: 15, D: 42, E: 18, F: 21, G: 28 });

  const sourceColumns = (partyHeader, partyKey) => [
    { header: 'Record ID', key: 'id' }, { header: 'Date', key: 'date', style: { numFmt: 'yyyy-mm-dd' } },
    { header: partyHeader, key: partyKey }, { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } },
    { header: 'Source row', key: 'sourceRow' },
  ];
  const invoiceColumns = [
    ...sourceColumns('Customer', 'customer'),
    { header: 'Source name', key: 'sourceName' }, { header: 'Source type', key: 'sourceType' },
    { header: 'Source locator', key: 'sourceLocator' }, { header: 'Extraction confidence', key: 'confidence' },
    { header: 'Source SHA-256', key: 'sourceHash' }, { header: 'Extraction model', key: 'extractionModel' },
  ];
  const invoiceRows = rows => rows.map(row => ({
    id: row.id, date: dateValue(row.date), customer: row.customer, amount: amount(row.amountKobo), sourceRow: row.sourceRow,
    sourceName: row.sourceName || 'CSV import', sourceType: row.sourceType || 'csv', sourceLocator: row.sourceLocator || `row ${row.sourceRow}`,
    confidence: row.confidence || 'source supplied', sourceHash: row.sourceHash || report.sourceHashes?.invoices || '', extractionModel: row.extractionModel || 'Not applicable',
  }));
  const bankRows = rows => rows.map(row => ({ id: row.id, date: dateValue(row.date), description: row.description, amount: amount(row.amountKobo), sourceRow: row.sourceRow }));
  addRowsSheet(workbook, 'Unresolved Invoices', invoiceColumns, invoiceRows(report.unresolvedInvoices), { A: 15, B: 15, C: 32, D: 18, E: 13, F: 30, G: 15, H: 20, I: 20, J: 68, K: 24 });
  addRowsSheet(workbook, 'Unresolved Bank', sourceColumns('Description', 'description'), bankRows(report.unresolvedBank), { A: 15, B: 15, C: 48, D: 18, E: 13 });
  const resolutions = addRowsSheet(workbook, 'Manual Resolutions', [
    { header: 'Review period', key: 'reviewTitle' }, { header: 'Resolution ID', key: 'id' }, { header: 'Record type', key: 'kind' }, { header: 'Record ID', key: 'recordId' },
    { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } }, { header: 'Review comment', key: 'comment' },
    { header: 'Reviewed at', key: 'reviewedAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } }, { header: 'Reviewer name', key: 'reviewerName' },
    { header: 'Reviewer email', key: 'reviewerEmail' }, { header: 'Reviewer UID', key: 'reviewerUid' },
    { header: 'Meta brief used', key: 'metaInvestigated' }, { header: 'Source SHA-256', key: 'sourceHash' },
  ], report.manualResolutions.map(row => ({
    ...row, amount: amount(row.amountKobo), reviewedAt: dateValue(row.reviewedAt),
    reviewerName: row.reviewer?.displayName || '', reviewerEmail: row.reviewer?.email || '', reviewerUid: row.reviewer?.uid || '',
    metaInvestigated: row.metaInvestigated ? 'Yes' : 'No',
  })), { A: 28, B: 36, C: 14, D: 16, E: 18, F: 68, G: 21, H: 26, I: 32, J: 30, K: 16, L: 68 });
  resolutions.getColumn('F').alignment = { vertical: 'top', wrapText: true };
  addRowsSheet(workbook, 'Rejected Proposals', [
    { header: 'Rejection ID', key: 'id' }, { header: 'Type', key: 'kind' }, { header: 'Invoice ID', key: 'invoiceId' },
    { header: 'Bank ID', key: 'bankId' }, { header: 'Cash entry IDs', key: 'cashEntryIds' },
    { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } }, { header: 'Reason', key: 'comment' },
    { header: 'Rejected at', key: 'rejectedAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } }, { header: 'Reviewer', key: 'reviewer' },
  ], report.rejectedProposals.map(row => ({ ...row, cashEntryIds: (row.cashEntryIds || []).join(', '), amount: amount(row.amountKobo), rejectedAt: dateValue(row.rejectedAt), reviewer: row.reviewer?.displayName || row.reviewer?.email || row.reviewer?.uid || '' })), { A: 38, B: 14, C: 16, D: 16, E: 38, F: 18, G: 60, H: 21, I: 28 });
  addRowsSheet(workbook, 'Sales Invoices', invoiceColumns, invoiceRows(report.invoices), { A: 15, B: 15, C: 32, D: 18, E: 13, F: 30, G: 15, H: 20, I: 20, J: 68, K: 24 });
  addRowsSheet(workbook, 'Bank Transactions', sourceColumns('Description', 'description'), bankRows(report.bank), { A: 15, B: 15, C: 48, D: 18, E: 13 });
  addRowsSheet(workbook, 'Cashbook', [
    { header: 'Cash ID', key: 'id' }, { header: 'Date', key: 'date', style: { numFmt: 'yyyy-mm-dd' } }, { header: 'Customer / source', key: 'customer' },
    { header: 'Description', key: 'description' }, { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } }, { header: 'Source row', key: 'sourceRow' },
    { header: 'Source name', key: 'sourceName' }, { header: 'Source SHA-256', key: 'sourceHash' },
  ], report.cashbook.map(row => ({ ...row, date: dateValue(row.date), amount: amount(row.amountKobo) })), { A: 16, B: 15, C: 28, D: 40, E: 18, F: 12, G: 28, H: 68 });
  addRowsSheet(workbook, 'Cash Deposits', [
    { header: 'Status', key: 'status' }, { header: 'Frequency', key: 'frequency' }, { header: 'Cash entry IDs', key: 'cashEntryIds' },
    { header: 'Bank ID', key: 'bankId' }, { header: 'Period start', key: 'startDate' }, { header: 'Period end', key: 'endDate' },
    { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } }, { header: 'Evidence rule', key: 'reason' },
  ], [
    ...report.cashReview.matches.map(row => ({ ...row, status: 'Approved', cashEntryIds: row.cashEntryIds.join(', '), amount: amount(row.amountKobo), reason: 'Human-approved exact cashbook-to-bank lodgement' })),
    ...report.cashReview.proposals.map(row => ({ ...row, status: 'Proposed - review required', cashEntryIds: row.cashEntryIds.join(', '), amount: amount(row.amountKobo) })),
  ], { A: 24, B: 14, C: 38, D: 15, E: 15, F: 15, G: 18, H: 62 });
  addRowsSheet(workbook, 'Stock Reconciliation', [
    { header: 'SKU', key: 'sku' }, { header: 'Item', key: 'item' }, { header: 'Unit', key: 'unit' },
    { header: 'Opening', key: 'openingQty' }, { header: 'Received', key: 'receivedQty' }, { header: 'Sold', key: 'soldQty' },
    { header: 'Adjustment', key: 'adjustmentQty' }, { header: 'Expected', key: 'expectedQty' }, { header: 'Counted', key: 'countedQty' },
    { header: 'Variance', key: 'varianceQty' }, { header: 'Status', key: 'status' },
  ], report.stockReview.items, { A: 15, B: 32, C: 12, D: 12, E: 12, F: 12, G: 13, H: 13, I: 13, J: 13, K: 14 });
  addRowsSheet(workbook, 'Review History', [
    { header: 'Review ID', key: 'id' }, { header: 'Title', key: 'title' }, { header: 'Started', key: 'startedAt' }, { header: 'Completed', key: 'completedAt' },
    { header: 'Invoices', key: 'invoices' }, { header: 'Cash entries', key: 'cashbook' }, { header: 'Bank rows', key: 'bank' }, { header: 'Stock items', key: 'stock' },
    { header: 'Reconciled value (NGN)', key: 'settlement', style: { numFmt: MONEY_FORMAT } }, { header: 'Manual resolutions', key: 'manualResolutions' },
    { header: 'Stock variances', key: 'stockVariances' }, { header: 'Completed by', key: 'completedBy' },
  ], report.reviewHistory.map(row => ({ ...row, startedAt: dateValue(row.startedAt), completedAt: dateValue(row.completedAt), ...row.counts, settlement: amount(row.totals.reconciledKobo ?? (row.totals.approvedInvoiceKobo + row.totals.bankedCashKobo)), manualResolutions: row.results.manualResolutions || 0, stockVariances: row.results.stockVarianceItems, completedBy: row.completedBy?.displayName || row.completedBy?.email || row.completedBy?.uid || '' })), { A: 22, B: 28, C: 21, D: 21, E: 11, F: 13, G: 11, H: 12, I: 24, J: 18, K: 16, L: 28 });

  const archivedSources = report.reviewHistory.flatMap(review => [
    ...(review.invoices || []).map(row => ({ review: review.title, type: 'invoice', id: row.id, date: row.date, party: row.customer, description: row.description || '', amount: amount(row.amountKobo), detail: '', sourceRow: row.sourceRow, sourceHash: row.sourceHash || review.sourceHashes?.invoices || '' })),
    ...(review.bank || []).map(row => ({ review: review.title, type: 'bank', id: row.id, date: row.date, party: '', description: row.description, amount: amount(row.amountKobo), detail: '', sourceRow: row.sourceRow, sourceHash: review.sourceHashes?.bank || '' })),
    ...(review.cashbook || []).map(row => ({ review: review.title, type: 'cashbook', id: row.id, date: row.date, party: row.customer || '', description: row.description || '', amount: amount(row.amountKobo), detail: '', sourceRow: row.sourceRow, sourceHash: row.sourceHash || review.sourceHashes?.cashbook || '' })),
    ...(review.stock || []).map(row => ({ review: review.title, type: 'stock', id: row.sku, date: '', party: row.item, description: row.unit, amount: null, detail: `opening ${row.openingQty}; received ${row.receivedQty}; sold ${row.soldQty}; adjustment ${row.adjustmentQty}; counted ${row.countedQty}`, sourceRow: row.sourceRow, sourceHash: review.sourceHashes?.stock || '' })),
  ]);
  addRowsSheet(workbook, 'Archived Sources', [
    { header: 'Review period', key: 'review' }, { header: 'Source type', key: 'type' }, { header: 'Record ID', key: 'id' },
    { header: 'Date', key: 'date' }, { header: 'Customer / item', key: 'party' }, { header: 'Description / unit', key: 'description' },
    { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } }, { header: 'Stock detail', key: 'detail' },
    { header: 'Source row', key: 'sourceRow' }, { header: 'Source SHA-256', key: 'sourceHash' },
  ], archivedSources, { A: 28, B: 15, C: 18, D: 15, E: 30, F: 38, G: 18, H: 70, I: 12, J: 68 });

  const archivedDecisions = report.reviewHistory.flatMap(review => [
    ...(review.approved || []).map(row => ({ review: review.title, type: 'invoice match', record: row.invoiceId, bankId: row.bankId, detail: '', at: row.reviewedAt, reviewer: row.reviewer?.displayName || row.reviewedBy || '' })),
    ...(review.cashAllocations || []).map(row => ({ review: review.title, type: 'cash deposit', record: (row.cashEntryIds || []).join(', '), bankId: row.bankId, detail: row.frequency || '', at: row.reviewedAt, reviewer: row.reviewer?.displayName || row.reviewedBy || '' })),
    ...(review.manualResolutions || []).map(row => ({ review: review.title, type: `${row.kind} resolution`, record: row.recordId, bankId: '', detail: row.comment, at: row.reviewedAt, reviewer: row.reviewer?.displayName || row.reviewer?.email || row.reviewer?.uid || '' })),
    ...(review.rejectedProposals || []).map(row => ({ review: review.title, type: `${row.kind} proposal rejected`, record: row.invoiceId || (row.cashEntryIds || []).join(', '), bankId: row.bankId, detail: row.comment, at: row.rejectedAt, reviewer: row.reviewer?.displayName || row.reviewer?.email || row.reviewer?.uid || '' })),
  ]);
  addRowsSheet(workbook, 'Archived Decisions', [
    { header: 'Review period', key: 'review' }, { header: 'Decision type', key: 'type' }, { header: 'Record(s)', key: 'record' },
    { header: 'Bank ID', key: 'bankId' }, { header: 'Comment / detail', key: 'detail' },
    { header: 'Decision time', key: 'at', style: { numFmt: 'yyyy-mm-dd hh:mm' } }, { header: 'Reviewer', key: 'reviewer' },
  ], archivedDecisions.map(row => ({ ...row, at: dateValue(row.at) })), { A: 28, B: 24, C: 38, D: 16, E: 68, F: 21, G: 30 });

  const briefRows = Object.entries(report.briefs).map(([invoiceId, brief]) => ({
    invoiceId, createdAt: dateValue(brief.createdAt), model: brief.model, briefStatus: brief.status,
    summary: brief.summary,
    hypotheses: (brief.hypotheses || []).map((item, index) => `${index + 1}. ${item.explanation} [${(item.evidenceIds || []).join(', ')}] Next: ${item.nextStep}`).join('\n'),
    missingEvidence: (brief.missingEvidence || []).join('\n'),
    automatedStatus: brief.verification?.status || 'not available',
    checksPassed: brief.verification?.checks?.filter(item => item.passed).length || 0,
    checksTotal: brief.verification?.checks?.length || 0,
    verifierVerdict: brief.verification?.modelReview?.verdict || 'not available',
    claimsChecked: brief.verification?.modelReview?.checkedClaims || 0,
    humanReview: brief.verification?.humanReview?.status || 'pending',
    reviewedAt: dateValue(brief.verification?.humanReview?.reviewedAt),
    sourceFingerprint: brief.sourceFingerprint,
  }));
  const briefs = addRowsSheet(workbook, 'AI Briefs', [
    { header: 'Invoice ID', key: 'invoiceId' }, { header: 'Created at', key: 'createdAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Model', key: 'model' }, { header: 'Brief status', key: 'briefStatus' }, { header: 'Summary', key: 'summary' },
    { header: 'Hypotheses and next checks', key: 'hypotheses' }, { header: 'Evidence still needed', key: 'missingEvidence' },
    { header: 'Automated status', key: 'automatedStatus' }, { header: 'Checks passed', key: 'checksPassed' },
    { header: 'Checks total', key: 'checksTotal' }, { header: 'Verifier verdict', key: 'verifierVerdict' },
    { header: 'Claims checked', key: 'claimsChecked' }, { header: 'Human review', key: 'humanReview' },
    { header: 'Reviewed at', key: 'reviewedAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Source fingerprint', key: 'sourceFingerprint' },
  ], briefRows, { A: 14, B: 21, C: 18, D: 16, E: 55, F: 70, G: 45, H: 20, I: 15, J: 14, K: 18, L: 15, M: 16, N: 21, O: 68 });
  ['E', 'F', 'G'].forEach(column => { briefs.getColumn(column).alignment = { vertical: 'top', wrapText: true }; });
  briefs.pageSetup.fitToWidth = 2;
  briefs.eachRow((row, rowNumber) => { if (rowNumber > 1) row.height = 90; });

  const agentSheet = addRowsSheet(workbook, 'Evidence Agent', [
    { header: 'Asked at', key: 'createdAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } }, { header: 'Question', key: 'question' },
    { header: 'Finding', key: 'finding' }, { header: 'Cited evidence', key: 'evidence' }, { header: 'Calculation', key: 'calculation' },
    { header: 'Confidence', key: 'confidence' }, { header: 'Missing evidence', key: 'missingEvidence' }, { header: 'Next check', key: 'nextCheck' },
    { header: 'Retrieval mode', key: 'retrievalMode' }, { header: 'Chunks considered', key: 'chunksConsidered' }, { header: 'Chunks selected', key: 'selectedCount' },
    { header: 'Model', key: 'model' }, { header: 'Automated status', key: 'automatedStatus' }, { header: 'Verifier verdict', key: 'verifierVerdict' },
    { header: 'Human review', key: 'humanReview' }, { header: 'Source fingerprint', key: 'sourceFingerprint' },
  ], report.agentAnswers.map(answer => ({
    createdAt: dateValue(answer.createdAt), question: answer.question, finding: answer.finding,
    evidence: (answer.evidence || []).map(item => `${item.sourceId}: ${item.statement}`).join('\n'), calculation: answer.calculation,
    confidence: answer.confidence, missingEvidence: (answer.missingEvidence || []).join('\n'), nextCheck: answer.nextCheck,
    retrievalMode: answer.retrieval?.mode, chunksConsidered: answer.retrieval?.chunksConsidered, selectedCount: answer.retrieval?.selectedCount,
    model: answer.model, automatedStatus: answer.verification?.status, verifierVerdict: answer.verification?.modelReview?.verdict,
    humanReview: answer.verification?.humanReview?.status || 'pending', sourceFingerprint: answer.sourceFingerprint,
  })), { A: 21, B: 48, C: 60, D: 70, E: 36, F: 14, G: 42, H: 45, I: 26, J: 18, K: 16, L: 18, M: 20, N: 18, O: 16, P: 68 });
  ['B', 'C', 'D', 'E', 'G', 'H'].forEach(column => { agentSheet.getColumn(column).alignment = { vertical: 'top', wrapText: true }; });
  agentSheet.pageSetup.fitToWidth = 2;
  agentSheet.eachRow((row, rowNumber) => { if (rowNumber > 1) row.height = 80; });

  const verificationRows = [];
  for (const [invoiceId, brief] of Object.entries(report.briefs)) {
    for (const check of brief.verification?.checks || []) verificationRows.push({
      invoiceId, category: 'Deterministic check', item: check.label, result: check.passed ? 'Passed' : 'Failed',
      detail: check.detail, evidenceIds: '', checkedAt: dateValue(brief.verification?.checkedAt),
    });
    for (const issue of brief.verification?.modelReview?.issues || []) verificationRows.push({
      invoiceId, category: 'Independent Muse review', item: issue.claim, result: brief.verification.modelReview.verdict,
      detail: issue.reason, evidenceIds: (issue.evidenceIds || []).join(', '), checkedAt: dateValue(brief.verification?.checkedAt),
    });
  }
  for (const answer of report.agentAnswers) {
    for (const check of answer.verification?.checks || []) verificationRows.push({
      invoiceId: `RAG ${iso(answer.createdAt)}`, category: 'RAG deterministic check', item: check.label,
      result: check.passed ? 'Passed' : 'Failed', detail: check.detail,
      evidenceIds: (answer.evidence || []).map(item => item.sourceId).join(', '), checkedAt: dateValue(answer.verification?.checkedAt),
    });
    for (const issue of answer.verification?.modelReview?.issues || []) verificationRows.push({
      invoiceId: `RAG ${iso(answer.createdAt)}`, category: 'RAG independent Muse review', item: issue.claim,
      result: answer.verification.modelReview.verdict, detail: issue.reason,
      evidenceIds: (issue.evidenceIds || []).join(', '), checkedAt: dateValue(answer.verification?.checkedAt),
    });
  }
  const checks = addRowsSheet(workbook, 'Verification Checks', [
    { header: 'Reference', key: 'invoiceId' }, { header: 'Category', key: 'category' }, { header: 'Check or claim', key: 'item' },
    { header: 'Result', key: 'result' }, { header: 'Detail', key: 'detail' }, { header: 'Evidence IDs', key: 'evidenceIds' },
    { header: 'Checked at', key: 'checkedAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } },
  ], verificationRows, { A: 14, B: 27, C: 36, D: 17, E: 62, F: 28, G: 21 });
  ['C', 'E'].forEach(column => { checks.getColumn(column).alignment = { vertical: 'top', wrapText: true }; });
  checks.eachRow((row, rowNumber) => { if (rowNumber > 1) row.height = 28; });

  addRowsSheet(workbook, 'Audit Trail', [
    { header: 'Review period', key: 'reviewTitle' }, { header: 'Timestamp', key: 'at', style: { numFmt: 'yyyy-mm-dd hh:mm' } }, { header: 'Action', key: 'action' },
    { header: 'Invoice ID', key: 'invoiceId' }, { header: 'Bank ID', key: 'bankId' }, { header: 'Import type', key: 'kind' },
    { header: 'Rows', key: 'rows' }, { header: 'Reviewer name', key: 'reviewerName' }, { header: 'Reviewer email', key: 'reviewerEmail' },
    { header: 'Reviewer UID', key: 'by' }, { header: 'Review comment', key: 'comment' }, { header: 'Source fingerprint', key: 'sourceFingerprint' },
  ], report.audit.map(event => ({ ...event, at: dateValue(event.at), reviewerName: event.actor?.displayName || '', reviewerEmail: event.actor?.email || '' })), { A: 28, B: 21, C: 24, D: 14, E: 14, F: 15, G: 10, H: 26, I: 32, J: 30, K: 68, L: 68 });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function buildReviewWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NaijaLedger';
  workbook.company = 'NaijaLedger';
  workbook.subject = 'Sales-to-bank reconciliation review report';
  workbook.title = 'NaijaLedger review report';
  workbook.created = new Date(report.generatedAt);
  workbook.modified = new Date(report.generatedAt);

  const issues = openIssueRows(report);
  const activePeriod = report.reviewCycle?.title || 'Current review';
  const activeIssues = issues.filter(row => row.period === activePeriod && row.status === 'Open in active review');
  const archivedIssues = issues.length - activeIssues.length;
  const summary = workbook.addWorksheet('Summary', { properties: { tabColor: { argb: `FF${GREEN}` } }, views: [{ showGridLines: false }] });
  summary.columns = [{ key: 'a', width: 29 }, { key: 'b', width: 32 }, { key: 'c', width: 29 }, { key: 'd', width: 42 }];
  summary.mergeCells('A1:D1'); summary.getCell('A1').value = 'NaijaLedger review report';
  summary.getCell('A1').font = { name: 'Arial', size: 18, bold: true, color: { argb: `FF${GREEN}` } }; summary.getRow(1).height = 34;
  summary.mergeCells('A2:D2'); summary.getCell('A2').value = 'Human-reviewed reconciliation evidence. Open items are disclosed and are not treated as reconciled.';
  summary.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${AMBER}` } }; summary.getCell('A2').font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF7A5421' } }; summary.getCell('A2').alignment = { wrapText: true, vertical: 'middle' }; summary.getRow(2).height = 30;
  summary.addRow([]);
  summary.addRow(['Current period', activePeriod, 'Generated', dateValue(report.generatedAt)]);
  summary.addRow(['Reconciled value', amount(report.totals.reconciledKobo), 'Ledger-reviewed sales', amount(report.totals.ledgerReviewedKobo)]);
  summary.addRow(['Approved invoice matches', report.matches.length, 'Approved cash lodgements', report.cashReview.matches.length]);
  summary.addRow(['Open items in active period', activeIssues.length, 'Open items preserved in history', archivedIssues]);
  summary.addRow(['Invoices / bank / cash / stock', `${report.invoices.length} / ${report.bank.length} / ${report.cashbook.length} / ${report.stockReview.items.length}`, 'Completed periods', report.reviewHistory.length]);
  summary.addRow(['Source fingerprints', 'See Source Records', 'Audit events', report.audit.length]);
  for (let row = 4; row <= 9; row += 1) {
    summary.getRow(row).font = { name: 'Arial', size: 10, color: { argb: `FF${TEXT}` } };
    summary.getCell(`A${row}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: `FF${MUTED}` } };
    summary.getCell(`C${row}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: `FF${MUTED}` } };
  }
  summary.getCell('D4').numFmt = 'yyyy-mm-dd hh:mm'; summary.getCell('B5').numFmt = MONEY_FORMAT; summary.getCell('D5').numFmt = MONEY_FORMAT;
  summary.addRow([]); summary.mergeCells('A11:D11'); summary.getCell('A11').value = 'Report contents';
  summary.getCell('A11').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREEN}` } }; summary.getCell('A11').font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  const guide = [
    ['Open Issues', 'Everything unresolved in the active review or preserved at an earlier period close.'],
    ['Reconciled', 'Only human-approved invoice matches and cash lodgements.'],
    ['Period History', 'Closing status, closing comment, reviewer, date and open-item count for each completed period.'],
    ['Source Records', 'Current and archived invoice, bank, cashbook and stock records with fingerprints.'],
    ['Decisions', 'Commented resolutions, rejected proposals and period-closing decisions.'],
    ['AI Evidence', 'Compact Meta brief and Evidence Agent summaries with model, checkpoint status and fingerprint.'],
    ['Audit Trail', 'Timestamped actions and reviewer identity.'],
  ];
  for (const row of guide) { const added = summary.addRow([row[0], row[1]]); summary.mergeCells(`B${added.number}:D${added.number}`); }
  summary.getRows(12, guide.length).forEach(row => { row.font = { name: 'Arial', size: 10, color: { argb: `FF${TEXT}` } }; row.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: `FF${GREEN}` } }; row.alignment = { vertical: 'top', wrapText: true }; row.height = 27; });
  summary.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };

  addRowsSheet(workbook, 'Open Issues', [
    { header: 'Review period', key: 'period' }, { header: 'Period status', key: 'status' }, { header: 'Issue type', key: 'type' },
    { header: 'Record(s)', key: 'record' }, { header: 'Date / period', key: 'date' }, { header: 'Customer / description', key: 'detail' },
    { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } }, { header: 'Outcome / next action', key: 'nextAction' },
  ], issues, { A: 28, B: 24, C: 27, D: 38, E: 20, F: 52, G: 18, H: 55 });

  addRowsSheet(workbook, 'Reconciled', [
    { header: 'Review period', key: 'period' }, { header: 'Reconciliation type', key: 'type' }, { header: 'Source records', key: 'sourceRecords' },
    { header: 'Customer', key: 'party' }, { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } },
    { header: 'Reviewed at', key: 'reviewedAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } }, { header: 'Reviewer', key: 'reviewer' }, { header: 'Evidence / narration', key: 'evidence' },
  ], reconciledRows(report), { A: 28, B: 22, C: 40, D: 28, E: 18, F: 21, G: 28, H: 52 });

  addRowsSheet(workbook, 'Period History', [
    { header: 'Review ID', key: 'id' }, { header: 'Period', key: 'title' }, { header: 'Started', key: 'startedAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Closed', key: 'completedAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } }, { header: 'Closure status', key: 'closureStatus' },
    { header: 'Open items at close', key: 'openItemCount' }, { header: 'Closing comment', key: 'closingComment' }, { header: 'Closed by', key: 'completedBy' },
    { header: 'Reconciled value (NGN)', key: 'reconciled', style: { numFmt: MONEY_FORMAT } },
  ], report.reviewHistory.map(row => ({ id: row.id, title: row.title, startedAt: dateValue(row.startedAt), completedAt: dateValue(row.completedAt), closureStatus: closureLabel(row.closure), openItemCount: row.closure?.openItemCount || 0, closingComment: row.closure?.comment || 'Not recorded for this earlier period', completedBy: reviewerName(row.completedBy), reconciled: amount(row.totals.reconciledKobo ?? (row.totals.approvedInvoiceKobo + row.totals.bankedCashKobo)) })), { A: 24, B: 28, C: 21, D: 21, E: 25, F: 18, G: 72, H: 30, I: 22 });

  addRowsSheet(workbook, 'Source Records', [
    { header: 'Review period', key: 'period' }, { header: 'Source type', key: 'type' }, { header: 'Record ID', key: 'id' },
    { header: 'Date', key: 'date', style: { numFmt: 'yyyy-mm-dd' } }, { header: 'Customer / item', key: 'party' }, { header: 'Description / stock detail', key: 'description' },
    { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } }, { header: 'Source row', key: 'sourceRow' }, { header: 'Source SHA-256', key: 'sourceHash' },
  ], sourceRows(report), { A: 28, B: 14, C: 18, D: 15, E: 30, F: 65, G: 18, H: 12, I: 68 });

  addRowsSheet(workbook, 'Decisions', [
    { header: 'Review period', key: 'period' }, { header: 'Decision', key: 'type' }, { header: 'Record(s)', key: 'records' },
    { header: 'Amount (NGN)', key: 'amount', style: { numFmt: MONEY_FORMAT } }, { header: 'Decision time', key: 'decisionAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Reviewer', key: 'reviewer' }, { header: 'Comment / reason', key: 'comment' },
  ], decisionRows(report), { A: 28, B: 30, C: 38, D: 18, E: 21, F: 30, G: 72 });

  addRowsSheet(workbook, 'AI Evidence', [
    { header: 'Review period', key: 'period' }, { header: 'Evidence type', key: 'type' }, { header: 'Reference / question', key: 'reference' },
    { header: 'Created at', key: 'createdAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } }, { header: 'Meta model', key: 'model' },
    { header: 'Human checkpoint', key: 'status' }, { header: 'Finding / summary', key: 'summary' }, { header: 'Source fingerprint', key: 'fingerprint' },
  ], aiEvidenceRows(report), { A: 28, B: 24, C: 54, D: 21, E: 20, F: 20, G: 72, H: 68 });

  addRowsSheet(workbook, 'Audit Trail', [
    { header: 'Review period', key: 'reviewTitle' }, { header: 'Timestamp', key: 'at', style: { numFmt: 'yyyy-mm-dd hh:mm' } }, { header: 'Action', key: 'action' },
    { header: 'Record / invoice', key: 'record' }, { header: 'Bank ID', key: 'bankId' }, { header: 'Reviewer', key: 'reviewer' },
    { header: 'Reviewer email', key: 'reviewerEmail' }, { header: 'Comment / detail', key: 'comment' }, { header: 'Open items', key: 'openItemCount' },
  ], report.audit.map(event => ({ ...event, at: dateValue(event.at), record: event.recordId || event.invoiceId || '', reviewer: reviewerName(event.actor) || event.by || 'System', reviewerEmail: event.actor?.email || '', comment: event.comment || (event.kind ? `${event.rows || 0} ${event.kind} rows` : ''), openItemCount: event.openItemCount ?? null })), { A: 28, B: 21, C: 28, D: 20, E: 16, F: 28, G: 32, H: 72, I: 14 });

  for (const sheet of workbook.worksheets.filter(row => row.name !== 'Summary')) {
    for (const column of sheet.columns) if (['detail', 'nextAction', 'evidence', 'closingComment', 'description', 'comment', 'summary', 'reference'].includes(column.key)) column.alignment = { vertical: 'top', wrapText: true };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function pdfTable(doc, headers, rows, widths, aligns = []) {
  const left = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom - 20;
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const suppliedWidth = widths.reduce((sum, width) => sum + width, 0);
  const scaledWidths = widths.map(width => width * (availableWidth / suppliedWidth));
  const drawHeader = () => {
    const headerY = doc.y;
    const height = 24;
    doc.save().rect(left, headerY, availableWidth, height).fill(`#${GREEN}`).restore();
    let x = left;
    headers.forEach((header, index) => {
      doc.fillColor('white').font('Helvetica-Bold').fontSize(8).text(text(header), x + 6, headerY + 7, { width: scaledWidths[index] - 12, align: aligns[index] || 'left', lineBreak: false });
      x += scaledWidths[index];
    });
    doc.y = headerY + height;
  };
  drawHeader();
  rows.forEach((row, rowIndex) => {
    const values = row.map(text);
    const height = Math.max(23, ...values.map((value, index) => doc.font('Helvetica').fontSize(8).heightOfString(value, { width: scaledWidths[index] - 12 }) + 12));
    if (doc.y + height > bottom) { doc.addPage(); drawHeader(); }
    const rowY = doc.y;
    if (rowIndex % 2 === 1) doc.save().rect(left, rowY, availableWidth, height).fill(`#${PALE_GREEN}`).restore();
    let x = left;
    values.forEach((value, index) => {
      doc.fillColor(`#${TEXT}`).font('Helvetica').fontSize(8).text(value, x + 6, rowY + 6, { width: scaledWidths[index] - 12, align: aligns[index] || 'left' });
      x += scaledWidths[index];
    });
    doc.save().moveTo(left, rowY + height).lineTo(left + availableWidth, rowY + height).strokeColor(`#${BORDER}`).lineWidth(0.4).stroke().restore();
    doc.y = rowY + height;
  });
  doc.x = left;
  doc.moveDown(0.7);
}

async function buildLegacyReviewPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', bufferPages: true, margins: { top: 54, right: 42, bottom: 48, left: 42 }, info: { Title: report.title, Author: 'NaijaLedger', Subject: 'Sales-to-bank reconciliation review pack' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const decorate = () => {
      const currentX = doc.x; const currentY = doc.y;
      doc.save().font('Helvetica-Bold').fontSize(8).fillColor(`#${GREEN}`).text('NaijaLedger', 42, 25, { lineBreak: false });
      doc.moveTo(42, 40).lineTo(doc.page.width - 42, 40).strokeColor(`#${BORDER}`).lineWidth(0.5).stroke().restore();
      doc.x = currentX; doc.y = currentY;
    };
    doc.on('pageAdded', decorate);
    decorate();
    const ensureSpace = height => { if (doc.y + height > doc.page.height - doc.page.margins.bottom - 20) doc.addPage(); };
    const section = title => {
      ensureSpace(68);
      doc.x = doc.page.margins.left;
      doc.moveDown(0.5).font('Helvetica-Bold').fontSize(11).fillColor(`#${GREEN}`).text(text(title));
      doc.moveTo(doc.page.margins.left, doc.y + 3).lineTo(doc.page.width - doc.page.margins.right, doc.y + 3).strokeColor(`#${BORDER}`).lineWidth(0.6).stroke();
      doc.moveDown(0.7);
    };
    const paragraph = (value, options = {}) => {
      ensureSpace(32);
      doc.x = doc.page.margins.left;
      doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 8.5).fillColor(options.color || `#${TEXT}`).text(text(value), { lineGap: 2, ...options });
      doc.moveDown(options.after ?? 0.45);
    };

    doc.font('Helvetica-Bold').fontSize(22).fillColor(`#${GREEN}`).text('NaijaLedger review pack');
    doc.font('Helvetica').fontSize(9).fillColor(`#${MUTED}`).text(`Generated ${iso(report.generatedAt).replace('T', ' ').replace('.000Z', ' UTC')}`);
    doc.moveDown(1);
    const warningY = doc.y;
    doc.save().roundedRect(42, warningY, doc.page.width - 84, 36, 7).fill(`#${AMBER}`).restore();
    doc.fillColor('#7A5421').font('Helvetica-Bold').fontSize(9).text(text(report.status), 54, warningY + 12, { width: doc.page.width - 108 });
    doc.y = warningY + 50;

    section('Review summary');
    pdfTable(doc, ['Metric', 'Value', 'Metric', 'Value'], [
      ['Workspace version', report.workspaceVersion, 'Invoices', report.invoices.length],
      ['Bank transactions', report.bank.length, 'Approved matches', report.matches.length],
      ['Unresolved invoices', report.unresolvedInvoices.length, 'Unresolved bank entries', report.unresolvedBank.length],
      ['Invoiced total', ngn(report.totals.invoicedKobo), 'Bank credit total', ngn(report.totals.bankCreditsKobo)],
      ['Approved total', ngn(report.totals.approvedKobo), 'Reconciled value', ngn(report.totals.reconciledKobo)],
      ['Ledger-reviewed sales', ngn(report.totals.ledgerReviewedKobo), 'Manually reviewed cash', ngn(report.totals.manualReviewedCashKobo)],
      ['Comment-resolved invoices', ngn(report.totals.manualReviewedInvoiceKobo), 'Comment-resolved bank', ngn(report.totals.manualReviewedBankKobo)],
      ['Cashbook total', ngn(report.cashReview.totals.cashSalesKobo), 'Approved cash deposits', report.cashReview.matches.length],
      ['Stock items', report.stockReview.summary.totalItems, 'Stock variances', report.stockReview.summary.varianceItems],
      ['Evidence Agent answers', report.agentAnswers.length, 'Completed reviews', report.reviewHistory.length],
    ], [112, 126, 112, 126], ['left', 'right', 'left', 'right']);

    ensureSpace(112);
    section('Source fingerprints');
    paragraph(`Sales invoices SHA-256: ${report.sourceHashes?.invoices || 'Not available'}`, { size: 7.8 });
    paragraph(`Bank transactions SHA-256: ${report.sourceHashes?.bank || 'Not available'}`, { size: 7.8 });
    paragraph(`Cashbook SHA-256: ${report.sourceHashes?.cashbook || 'Not available'}`, { size: 7.8 });
    paragraph(`Stock SHA-256: ${report.sourceHashes?.stock || 'Not available'}`, { size: 7.8 });

    const invoiceById = new Map(report.invoices.map(row => [row.id, row]));
    const bankById = new Map(report.bank.map(row => [row.id, row]));
    section('Approved matches');
    if (report.matches.length) pdfTable(doc, ['Invoice', 'Customer', 'Bank record', 'Bank description', 'Amount'], report.matches.map(match => [
      match.invoiceId, invoiceById.get(match.invoiceId)?.customer || '', match.bankId, bankById.get(match.bankId)?.description || '', ngn(match.amountKobo),
    ]), [60, 100, 64, 190, 62], ['left', 'left', 'left', 'left', 'right']);
    else paragraph('No approved matches.', { color: `#${MUTED}` });

    section('Commented human resolutions');
    if (report.manualResolutions.length) pdfTable(doc, ['Review', 'Type', 'Record', 'Amount', 'Reviewed at', 'Reviewer', 'Review comment'], report.manualResolutions.map(row => [
      row.reviewTitle || 'Current review', row.kind, row.recordId, ngn(row.amountKobo), iso(row.reviewedAt).replace('T', ' ').replace('.000Z', ' UTC'),
      row.reviewer?.displayName || row.reviewer?.email || row.reviewer?.uid || 'Reviewer', row.comment,
    ]), [70, 42, 54, 62, 82, 74, 92], ['left', 'left', 'left', 'right', 'left', 'left', 'left']);
    else paragraph('No manually resolved exceptions.', { color: `#${MUTED}` });

    section('Unresolved invoices');
    if (report.unresolvedInvoices.length) pdfTable(doc, ['Invoice', 'Date', 'Customer', 'Source row', 'Amount'], report.unresolvedInvoices.map(row => [row.id, row.date, row.customer, row.sourceRow, ngn(row.amountKobo)]), [64, 72, 188, 70, 82], ['left', 'left', 'left', 'right', 'right']);
    else paragraph('No unresolved invoices.', { color: `#${MUTED}` });

    section('Unresolved bank entries');
    if (report.unresolvedBank.length) pdfTable(doc, ['Bank record', 'Date', 'Description', 'Source row', 'Amount'], report.unresolvedBank.map(row => [row.id, row.date, row.description, row.sourceRow, ngn(row.amountKobo)]), [68, 72, 184, 70, 82], ['left', 'left', 'left', 'right', 'right']);
    else paragraph('No unresolved bank entries.', { color: `#${MUTED}` });

    section('Cashbook and bank lodgements');
    if (report.cashReview.matches.length) pdfTable(doc, ['Status', 'Cash entries', 'Period', 'Bank record', 'Amount'], report.cashReview.matches.map(row => [
      'Approved', row.cashEntryIds.join(', '), `${row.startDate} to ${row.endDate}`, row.bankId, ngn(row.amountKobo),
    ]), [62, 144, 110, 78, 82], ['left', 'left', 'left', 'left', 'right']);
    if (report.cashReview.proposals.length) pdfTable(doc, ['Status', 'Cash entries', 'Period', 'Bank record', 'Amount'], report.cashReview.proposals.map(row => [
      'Proposed', row.cashEntryIds.join(', '), `${row.startDate} to ${row.endDate}`, row.bankId, ngn(row.amountKobo),
    ]), [62, 144, 110, 78, 82], ['left', 'left', 'left', 'left', 'right']);
    if (!report.cashReview.matches.length && !report.cashReview.proposals.length) paragraph('No cash-lodgement matches or proposals.', { color: `#${MUTED}` });

    section('Stock reconciliation');
    if (report.stockReview.items.length) pdfTable(doc, ['SKU', 'Item', 'Expected', 'Counted', 'Variance', 'Status'], report.stockReview.items.map(row => [
      row.sku, row.item, row.expectedQty, row.countedQty, row.varianceQty, row.status,
    ]), [68, 190, 58, 58, 58, 44], ['left', 'left', 'right', 'right', 'right', 'left']);
    else paragraph('No stock records loaded.', { color: `#${MUTED}` });

    section('Completed review history');
    if (report.reviewHistory.length) pdfTable(doc, ['Completed', 'Review', 'Sources', 'Reconciled', 'Manual', 'Stock'], report.reviewHistory.map(row => [
      iso(row.completedAt).slice(0, 10), row.title, `${row.counts.invoices} inv / ${row.counts.cashbook} cash / ${row.counts.bank} bank`, ngn(row.totals.reconciledKobo ?? (row.totals.approvedInvoiceKobo + row.totals.bankedCashKobo)), row.results.manualResolutions || 0, row.results.stockVarianceItems,
    ]), [68, 118, 108, 92, 45, 45], ['left', 'left', 'left', 'right', 'right', 'right']);
    else paragraph('No completed review cycles yet.', { color: `#${MUTED}` });

    section('NaijaLedger Evidence Agent - retrieved sources and answers');
    if (!report.agentAnswers.length) paragraph('No Evidence Agent questions have been asked.', { color: `#${MUTED}` });
    for (const answer of report.agentAnswers) {
      ensureSpace(150);
      const answerY = doc.y;
      doc.save().roundedRect(42, answerY, doc.page.width - 84, 25, 5).fill(`#${LIGHT_GREEN}`).restore();
      doc.fillColor(`#${GREEN}`).font('Helvetica-Bold').fontSize(9).text(`Evidence Agent - ${text(answer.model)}`, 50, answerY + 8, { lineBreak: false });
      doc.y = answerY + 34;
      paragraph(`Question: ${answer.question}`, { bold: true, size: 9 });
      paragraph(`Retrieval: ${answer.retrieval?.mode || 'not available'} | ${answer.retrieval?.selectedCount || 0} of ${answer.retrieval?.chunksConsidered || 0} chunks selected`, { size: 7.6, color: `#${MUTED}` });
      if (answer.retrieval?.evidence?.length) pdfTable(doc, ['Retrieved source', 'Type', 'Locator', 'Retrieval reason'], answer.retrieval.evidence.map(source => [
        source.id, source.type, source.locator, source.retrievalReason,
      ]), [104, 74, 112, 186]);
      paragraph(`Finding: ${answer.finding}`, { bold: true, size: 8.5 });
      for (const item of answer.evidence || []) paragraph(`Citation ${item.sourceId}: ${item.statement} (${item.locator})`, { size: 7.8 });
      if (answer.calculation) paragraph(`Calculation: ${answer.calculation}`, { size: 8 });
      if (answer.missingEvidence?.length) paragraph(`Evidence still needed: ${answer.missingEvidence.join('; ')}`, { size: 8 });
      paragraph(`Next check: ${answer.nextCheck}`, { size: 8 });
      const verification = answer.verification;
      if (verification) {
        paragraph(`Automated status: ${verification.status} | Independent Muse verdict: ${verification.modelReview?.verdict || 'not available'} | Claims checked: ${verification.modelReview?.checkedClaims || 0}`, { bold: true, size: 8 });
        pdfTable(doc, ['RAG check', 'Result', 'Detail'], (verification.checks || []).map(check => [check.label, check.passed ? 'Passed' : 'Failed', check.detail]), [126, 62, 288], ['left', 'center', 'left']);
        const human = verification.humanReview || { status: 'pending' };
        paragraph(`Human checkpoint: ${human.status}${human.reviewedAt ? ` at ${iso(human.reviewedAt)}` : ''}. ${answer.decisionBoundary}`, { size: 8, color: human.status === 'reviewed' ? `#${GREEN}` : '#7A5421' });
      }
      paragraph(`Source fingerprint: ${answer.sourceFingerprint}`, { size: 7.2, color: `#${MUTED}` });
      doc.moveDown(0.8);
    }

    section('Meta evidence briefs and verification receipts');
    const briefs = Object.entries(report.briefs);
    if (!briefs.length) paragraph('No Meta evidence briefs have been generated.', { color: `#${MUTED}` });
    for (const [invoiceId, brief] of briefs) {
      ensureSpace(120);
      const briefY = doc.y;
      doc.save().roundedRect(42, briefY, doc.page.width - 84, 25, 5).fill(`#${LIGHT_GREEN}`).restore();
      doc.fillColor(`#${GREEN}`).font('Helvetica-Bold').fontSize(9).text(`${text(invoiceId)} - ${text(brief.model)}`, 50, briefY + 8, { lineBreak: false });
      doc.y = briefY + 34;
      paragraph(brief.summary, { bold: true, size: 9 });
      paragraph(`Created: ${iso(brief.createdAt)} | Source fingerprint: ${brief.sourceFingerprint}`, { size: 7.4, color: `#${MUTED}` });
      (brief.hypotheses || []).forEach((hypothesis, index) => {
        paragraph(`Hypothesis ${index + 1} (${hypothesis.confidence}): ${hypothesis.explanation}`, { size: 8 });
        paragraph(`Evidence IDs: ${(hypothesis.evidenceIds || []).join(', ') || 'None'} | Next check: ${hypothesis.nextStep}`, { size: 7.6, color: `#${MUTED}` });
      });
      if (brief.missingEvidence?.length) paragraph(`Evidence still needed: ${brief.missingEvidence.join('; ')}`, { size: 8 });
      const verification = brief.verification;
      if (verification) {
        paragraph(`Automated status: ${verification.status} | Independent Muse verdict: ${verification.modelReview?.verdict || 'not available'} | Claims checked: ${verification.modelReview?.checkedClaims || 0}`, { bold: true, size: 8 });
        pdfTable(doc, ['Deterministic check', 'Result', 'Detail'], (verification.checks || []).map(check => [check.label, check.passed ? 'Passed' : 'Failed', check.detail]), [126, 62, 288], ['left', 'center', 'left']);
        const human = verification.humanReview || { status: 'pending' };
        paragraph(`Human checkpoint: ${human.status}${human.reviewedAt ? ` at ${iso(human.reviewedAt)}` : ''}. This acknowledgment does not approve a match or tax treatment.`, { size: 8, color: human.status === 'reviewed' ? `#${GREEN}` : '#7A5421' });
      }
      doc.moveDown(0.8);
    }

    section('Audit trail');
    if (report.audit.length) pdfTable(doc, ['Timestamp', 'Action', 'Record', 'Reviewer', 'Comment / detail'], report.audit.map(event => [
      iso(event.at).replace('T', ' ').replace('.000Z', ' UTC'), event.action, event.invoiceId || event.bankId || event.recordId || '',
      event.actor?.displayName || event.actor?.email || event.by || 'System', event.comment || (event.kind ? `${event.rows || 0} ${event.kind} rows` : ''),
    ]), [108, 94, 66, 94, 114]);
    else paragraph('No audit activity.', { color: `#${MUTED}` });

    const pages = doc.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
      doc.switchToPage(index);
      const savedX = doc.x; const savedY = doc.y;
      doc.font('Helvetica').fontSize(7).fillColor(`#${MUTED}`).text(`Page ${index + 1} of ${pages.count} | Human review required | NaijaLedger`, 42, doc.page.height - doc.page.margins.bottom - 13, { width: doc.page.width - 84, align: 'center', lineBreak: false });
      doc.x = savedX; doc.y = savedY;
    }
    doc.end();
  });
}

export async function buildReviewPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', bufferPages: true, margins: { top: 54, right: 42, bottom: 48, left: 42 }, info: { Title: 'NaijaLedger review report', Author: 'NaijaLedger', Subject: 'Human-reviewed reconciliation evidence' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk)); doc.on('error', reject); doc.on('end', () => resolve(Buffer.concat(chunks)));
    const decorate = () => {
      const x = doc.x; const y = doc.y;
      doc.save().font('Helvetica-Bold').fontSize(8).fillColor(`#${GREEN}`).text('NaijaLedger', 42, 25, { lineBreak: false });
      doc.moveTo(42, 40).lineTo(doc.page.width - 42, 40).strokeColor(`#${BORDER}`).lineWidth(0.5).stroke().restore(); doc.x = x; doc.y = y;
    };
    doc.on('pageAdded', decorate); decorate();
    const ensure = height => { if (doc.y + height > doc.page.height - doc.page.margins.bottom - 20) doc.addPage(); };
    const section = title => { ensure(60); doc.x = doc.page.margins.left; doc.moveDown(0.55).font('Helvetica-Bold').fontSize(11).fillColor(`#${GREEN}`).text(text(title)); doc.moveTo(doc.page.margins.left, doc.y + 3).lineTo(doc.page.width - doc.page.margins.right, doc.y + 3).strokeColor(`#${BORDER}`).lineWidth(0.6).stroke(); doc.moveDown(0.7); };
    const paragraph = (value, options = {}) => { ensure(32); doc.x = doc.page.margins.left; doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 8.5).fillColor(options.color || `#${TEXT}`).text(text(value), { lineGap: 2, ...options }); doc.moveDown(options.after ?? 0.45); };

    const issues = openIssueRows(report);
    const reconciled = reconciledRows(report);
    const decisions = decisionRows(report);
    const ai = aiEvidenceRows(report);
    const activePeriod = report.reviewCycle?.title || 'Current review';
    const activeIssues = issues.filter(row => row.period === activePeriod && row.status === 'Open in active review').length;

    doc.font('Helvetica-Bold').fontSize(22).fillColor(`#${GREEN}`).text('NaijaLedger review report');
    doc.font('Helvetica').fontSize(9).fillColor(`#${MUTED}`).text(`Generated ${iso(report.generatedAt).replace('T', ' ').replace('.000Z', ' UTC')}`);
    doc.moveDown(0.8);
    const noticeY = doc.y; doc.save().roundedRect(42, noticeY, doc.page.width - 84, 40, 7).fill(`#${AMBER}`).restore();
    doc.fillColor('#7A5421').font('Helvetica-Bold').fontSize(9).text('Open items are disclosed, remain unresolved, and are excluded from reconciled value. This report is not a tax filing or accounting certification.', 54, noticeY + 11, { width: doc.page.width - 108 }); doc.y = noticeY + 54;

    section('Decision summary');
    pdfTable(doc, ['Metric', 'Value', 'Metric', 'Value'], [
      ['Current period', activePeriod, 'Current open items', activeIssues],
      ['Reconciled value', ngn(report.totals.reconciledKobo), 'Ledger-reviewed sales', ngn(report.totals.ledgerReviewedKobo)],
      ['Approved invoice matches', report.matches.length, 'Approved cash lodgements', report.cashReview.matches.length],
      ['Invoices / bank rows', `${report.invoices.length} / ${report.bank.length}`, 'Cash / stock rows', `${report.cashbook.length} / ${report.stockReview.items.length}`],
      ['Completed periods', report.reviewHistory.length, 'Audit events', report.audit.length],
    ], [122, 116, 122, 116], ['left', 'right', 'left', 'right']);

    section('Completed period status and closing comments');
    if (report.reviewHistory.length) pdfTable(doc, ['Period', 'Closed', 'Status', 'Open', 'Reviewer', 'Closing comment'], report.reviewHistory.map(row => [
      row.title, iso(row.completedAt).replace('T', ' ').replace('.000Z', ' UTC'), closureLabel(row.closure), row.closure?.openItemCount || 0, reviewerName(row.completedBy), row.closure?.comment || 'Not recorded for this earlier period',
    ]), [92, 92, 90, 38, 82, 136], ['left', 'left', 'left', 'right', 'left', 'left']);
    else paragraph('No completed periods yet.', { color: `#${MUTED}` });

    section('Open and unresolved items');
    if (issues.length) pdfTable(doc, ['Period', 'Status', 'Issue', 'Record(s)', 'Description', 'Amount / outcome'], issues.map(row => [
      row.period, row.status, row.type, row.record, row.detail || row.nextAction, row.amount == null ? row.nextAction : `NGN ${Number(row.amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
    ]), [78, 82, 86, 92, 148, 72]);
    else paragraph('No open issues in the active review or completed-period history.', { color: `#${GREEN}`, bold: true });

    section('Approved reconciliations');
    if (reconciled.length) pdfTable(doc, ['Period', 'Type', 'Source records', 'Customer', 'Amount', 'Reviewed by'], reconciled.map(row => [
      row.period, row.type, row.sourceRecords, row.party, `NGN ${Number(row.amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`, row.reviewer,
    ]), [88, 76, 120, 92, 78, 70], ['left', 'left', 'left', 'left', 'right', 'left']);
    else paragraph('No human-approved reconciliations.', { color: `#${MUTED}` });

    section('Human decisions and audit comments');
    if (decisions.length) pdfTable(doc, ['Period', 'Decision', 'Record(s)', 'Reviewer', 'Comment / reason'], decisions.map(row => [row.period, row.type, row.records, row.reviewer, row.comment]), [86, 104, 88, 86, 160]);
    else paragraph('No commented resolutions, rejected proposals or completed-period decisions.', { color: `#${MUTED}` });

    section('Meta evidence summary');
    if (ai.length) pdfTable(doc, ['Period', 'Type', 'Reference / question', 'Model', 'Checkpoint', 'Finding / summary'], ai.map(row => [row.period, row.type, row.reference, row.model, row.status, row.summary]), [72, 80, 130, 70, 66, 146]);
    else paragraph('No Meta evidence outputs were generated.', { color: `#${MUTED}` });

    section('Audit trail');
    if (report.audit.length) pdfTable(doc, ['Timestamp', 'Period', 'Action', 'Record', 'Reviewer', 'Comment / detail'], report.audit.map(event => [
      iso(event.at).replace('T', ' ').replace('.000Z', ' UTC'), event.reviewTitle || activePeriod, event.action, event.recordId || event.invoiceId || event.bankId || '', reviewerName(event.actor) || event.by || 'System', event.comment || (event.kind ? `${event.rows || 0} ${event.kind} rows` : ''),
    ]), [86, 82, 90, 68, 76, 126]);
    else paragraph('No audit activity.', { color: `#${MUTED}` });

    const pages = doc.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
      doc.switchToPage(index); const x = doc.x; const y = doc.y;
      doc.font('Helvetica').fontSize(7).fillColor(`#${MUTED}`).text(`Page ${index + 1} of ${pages.count} | Human review required | NaijaLedger`, 42, doc.page.height - doc.page.margins.bottom - 13, { width: doc.page.width - 84, align: 'center', lineBreak: false }); doc.x = x; doc.y = y;
    }
    doc.end();
  });
}


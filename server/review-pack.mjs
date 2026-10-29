import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { reconcile } from './reconcile.mjs';

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

export function createReviewPack(state, generatedAt = new Date().toISOString()) {
  return {
    title: 'NaijaLedger review pack',
    generatedAt,
    status: 'Human review required; not a tax filing or accounting certification',
    sourceHashes: state.imports,
    workspaceVersion: state.version,
    ...reconcile(state.invoices, state.bank, state.approved),
    invoices: state.invoices,
    bank: state.bank,
    approved: state.approved,
    briefs: state.briefs || {},
    audit: state.audit || [],
    updatedAt: state.updatedAt,
  };
}

function styleWorksheet(sheet, widths = {}) {
  sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  sheet.pageSetup = {
    orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
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

export async function buildReviewWorkbook(report) {
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
    ['Approved total', amount(report.totals.approvedKobo), 'AI evidence briefs', Object.keys(report.briefs).length],
  ];
  summary.addRows([[], ['Review summary'], ...summaryRows]);
  const sectionRow = 4;
  summary.mergeCells(`A${sectionRow}:D${sectionRow}`);
  summary.getRow(sectionRow).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREEN}` } };
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  });
  for (let row = 5; row <= 10; row += 1) {
    summary.getRow(row).font = { name: 'Arial', size: 10, color: { argb: `FF${TEXT}` } };
    summary.getCell(`A${row}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: `FF${MUTED}` } };
    summary.getCell(`C${row}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: `FF${MUTED}` } };
  }
  ['B9', 'D9', 'B10'].forEach(ref => { summary.getCell(ref).numFmt = MONEY_FORMAT; });
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
  summary.getRows(hashHeading.number + 1, 2).forEach(row => {
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
  const invoiceRows = rows => rows.map(row => ({ id: row.id, date: dateValue(row.date), customer: row.customer, amount: amount(row.amountKobo), sourceRow: row.sourceRow }));
  const bankRows = rows => rows.map(row => ({ id: row.id, date: dateValue(row.date), description: row.description, amount: amount(row.amountKobo), sourceRow: row.sourceRow }));
  addRowsSheet(workbook, 'Unresolved Invoices', sourceColumns('Customer', 'customer'), invoiceRows(report.unresolvedInvoices), { A: 15, B: 15, C: 32, D: 18, E: 13 });
  addRowsSheet(workbook, 'Unresolved Bank', sourceColumns('Description', 'description'), bankRows(report.unresolvedBank), { A: 15, B: 15, C: 48, D: 18, E: 13 });
  addRowsSheet(workbook, 'Sales Invoices', sourceColumns('Customer', 'customer'), invoiceRows(report.invoices), { A: 15, B: 15, C: 32, D: 18, E: 13 });
  addRowsSheet(workbook, 'Bank Transactions', sourceColumns('Description', 'description'), bankRows(report.bank), { A: 15, B: 15, C: 48, D: 18, E: 13 });

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
  const checks = addRowsSheet(workbook, 'Verification Checks', [
    { header: 'Invoice ID', key: 'invoiceId' }, { header: 'Category', key: 'category' }, { header: 'Check or claim', key: 'item' },
    { header: 'Result', key: 'result' }, { header: 'Detail', key: 'detail' }, { header: 'Evidence IDs', key: 'evidenceIds' },
    { header: 'Checked at', key: 'checkedAt', style: { numFmt: 'yyyy-mm-dd hh:mm' } },
  ], verificationRows, { A: 14, B: 27, C: 36, D: 17, E: 62, F: 28, G: 21 });
  ['C', 'E'].forEach(column => { checks.getColumn(column).alignment = { vertical: 'top', wrapText: true }; });
  checks.eachRow((row, rowNumber) => { if (rowNumber > 1) row.height = 28; });

  addRowsSheet(workbook, 'Audit Trail', [
    { header: 'Timestamp', key: 'at', style: { numFmt: 'yyyy-mm-dd hh:mm' } }, { header: 'Action', key: 'action' },
    { header: 'Invoice ID', key: 'invoiceId' }, { header: 'Bank ID', key: 'bankId' }, { header: 'Import type', key: 'kind' },
    { header: 'Rows', key: 'rows' }, { header: 'Actor', key: 'by' }, { header: 'Source fingerprint', key: 'sourceFingerprint' },
  ], report.audit.map(event => ({ ...event, at: dateValue(event.at) })), { A: 21, B: 24, C: 14, D: 14, E: 15, F: 10, G: 28, H: 68 });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function pdfTable(doc, headers, rows, widths, aligns = []) {
  const left = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom - 20;
  const drawHeader = () => {
    const headerY = doc.y;
    const height = 24;
    doc.save().rect(left, headerY, widths.reduce((sum, width) => sum + width, 0), height).fill(`#${GREEN}`).restore();
    let x = left;
    headers.forEach((header, index) => {
      doc.fillColor('white').font('Helvetica-Bold').fontSize(7.5).text(text(header), x + 5, headerY + 7, { width: widths[index] - 10, align: aligns[index] || 'left', lineBreak: false });
      x += widths[index];
    });
    doc.y = headerY + height;
  };
  drawHeader();
  rows.forEach((row, rowIndex) => {
    const values = row.map(text);
    const height = Math.max(23, ...values.map((value, index) => doc.font('Helvetica').fontSize(7.5).heightOfString(value, { width: widths[index] - 10 }) + 10));
    if (doc.y + height > bottom) { doc.addPage(); drawHeader(); }
    const rowY = doc.y;
    if (rowIndex % 2 === 1) doc.save().rect(left, rowY, widths.reduce((sum, width) => sum + width, 0), height).fill(`#${PALE_GREEN}`).restore();
    let x = left;
    values.forEach((value, index) => {
      doc.fillColor(`#${TEXT}`).font('Helvetica').fontSize(7.5).text(value, x + 5, rowY + 5, { width: widths[index] - 10, align: aligns[index] || 'left' });
      x += widths[index];
    });
    doc.save().moveTo(left, rowY + height).lineTo(left + widths.reduce((sum, width) => sum + width, 0), rowY + height).strokeColor(`#${BORDER}`).lineWidth(0.4).stroke().restore();
    doc.y = rowY + height;
  });
  doc.x = left;
  doc.moveDown(0.7);
}

export async function buildReviewPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 54, right: 42, bottom: 48, left: 42 }, info: { Title: report.title, Author: 'NaijaLedger', Subject: 'Sales-to-bank reconciliation review pack' } });
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
      ensureSpace(38);
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
      ['Approved total', ngn(report.totals.approvedKobo), 'AI evidence briefs', Object.keys(report.briefs).length],
    ], [112, 126, 112, 126], ['left', 'right', 'left', 'right']);

    section('Source fingerprints');
    paragraph(`Sales invoices SHA-256: ${report.sourceHashes?.invoices || 'Not available'}`, { size: 7.8 });
    paragraph(`Bank transactions SHA-256: ${report.sourceHashes?.bank || 'Not available'}`, { size: 7.8 });

    const invoiceById = new Map(report.invoices.map(row => [row.id, row]));
    const bankById = new Map(report.bank.map(row => [row.id, row]));
    section('Approved matches');
    if (report.matches.length) pdfTable(doc, ['Invoice', 'Customer', 'Bank record', 'Bank description', 'Amount'], report.matches.map(match => [
      match.invoiceId, invoiceById.get(match.invoiceId)?.customer || '', match.bankId, bankById.get(match.bankId)?.description || '', ngn(match.amountKobo),
    ]), [60, 100, 64, 190, 62], ['left', 'left', 'left', 'left', 'right']);
    else paragraph('No approved matches.', { color: `#${MUTED}` });

    section('Unresolved invoices');
    if (report.unresolvedInvoices.length) pdfTable(doc, ['Invoice', 'Date', 'Customer', 'Source row', 'Amount'], report.unresolvedInvoices.map(row => [row.id, row.date, row.customer, row.sourceRow, ngn(row.amountKobo)]), [64, 72, 188, 70, 82], ['left', 'left', 'left', 'right', 'right']);
    else paragraph('No unresolved invoices.', { color: `#${MUTED}` });

    section('Unresolved bank entries');
    if (report.unresolvedBank.length) pdfTable(doc, ['Bank record', 'Date', 'Description', 'Source row', 'Amount'], report.unresolvedBank.map(row => [row.id, row.date, row.description, row.sourceRow, ngn(row.amountKobo)]), [68, 72, 184, 70, 82], ['left', 'left', 'left', 'right', 'right']);
    else paragraph('No unresolved bank entries.', { color: `#${MUTED}` });

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
    if (report.audit.length) pdfTable(doc, ['Timestamp', 'Action', 'Invoice', 'Bank record', 'Actor / detail'], report.audit.map(event => [
      iso(event.at).replace('T', ' ').replace('.000Z', ' UTC'), event.action, event.invoiceId || '', event.bankId || '', event.by || (event.kind ? `${event.rows || 0} ${event.kind} rows` : ''),
    ]), [114, 104, 68, 74, 116]);
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

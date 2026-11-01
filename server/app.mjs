import express from 'express';
import multer from 'multer';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, sha256 } from './csv.mjs';
import { extractInvoiceIntake, INTAKE_LIMITS } from './intake.mjs';
import { reconcile } from './reconcile.mjs';
import { evidenceFor, investigateWithMeta } from './meta.mjs';
import { reconcileCashbook, reconcileStock, reviewCycleSnapshot } from './operations.mjs';
import { createRagAgent } from './rag.mjs';
import { buildReviewPdf, buildReviewWorkbook, createReviewPack } from './review-pack.mjs';
import { seedWorkspace } from './store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DEMO_LIMITS = Object.freeze({ intake: 3, investigate: 5, agent: 3 });
const resolutionSets = state => {
  const manualResolutions = state.manualResolutions || [];
  return {
    manualResolutions,
    invoiceIds: new Set(manualResolutions.filter(row => row.kind === 'invoice').map(row => row.recordId)),
    bankIds: new Set(manualResolutions.filter(row => row.kind === 'bank').map(row => row.recordId)),
  };
};

const calculateReview = state => {
  const cashbook = state.cashbook || [];
  const cashAllocations = state.cashAllocations || [];
  const resolutions = resolutionSets(state);
  const blockedBankIds = [...cashAllocations.map(row => row.bankId), ...resolutions.bankIds];
  const invoiceReview = reconcile(state.invoices, state.bank, state.approved || [], blockedBankIds, [...resolutions.invoiceIds]);
  const cashReview = reconcileCashbook(cashbook, state.bank, cashAllocations, [
    ...invoiceReview.matches.map(row => row.bankId),
    ...invoiceReview.proposals.map(row => row.bankId),
    ...resolutions.bankIds,
  ]);
  const cashBankIds = new Set([...cashReview.matches, ...cashReview.proposals].map(row => row.bankId));
  const unresolvedBank = invoiceReview.unresolvedBank.filter(row => !cashBankIds.has(row.id));
  const manualReviewedInvoiceKobo = resolutions.manualResolutions
    .filter(row => row.kind === 'invoice').reduce((total, row) => total + Number(row.amountKobo || 0), 0);
  const manualReviewedBankKobo = resolutions.manualResolutions
    .filter(row => row.kind === 'bank').reduce((total, row) => total + Number(row.amountKobo || 0), 0);
  return {
    invoiceReview, cashReview, unresolvedBank, manualResolutions: resolutions.manualResolutions,
    closeBlockers: {
      invoiceProposals: invoiceReview.proposals.length,
      cashProposals: cashReview.proposals.length,
      unresolvedInvoices: invoiceReview.unresolvedInvoices.length,
      unresolvedBank: unresolvedBank.length,
      total: invoiceReview.proposals.length + cashReview.proposals.length + invoiceReview.unresolvedInvoices.length + unresolvedBank.length,
    },
    manualTotals: {
      invoiceKobo: manualReviewedInvoiceKobo,
      bankKobo: manualReviewedBankKobo,
      reviewedKobo: manualReviewedInvoiceKobo + manualReviewedBankKobo,
    },
  };
};

const actorSnapshot = identity => ({
  uid: identity.uid,
  displayName: identity.displayName || (identity.isAnonymous ? 'Judge Demo reviewer' : 'Signed-in reviewer'),
  email: identity.email || null,
  isAnonymous: identity.isAnonymous === true,
});

const view = (state, isDemo = false) => {
  const cashbook = state.cashbook || [];
  const cashAllocations = state.cashAllocations || [];
  const review = calculateReview(state);
  const totals = {
    ...review.invoiceReview.totals,
    manualReviewedInvoiceKobo: review.manualTotals.invoiceKobo,
    manualReviewedBankKobo: review.manualTotals.bankKobo,
    manualReviewedKobo: review.manualTotals.reviewedKobo,
    reviewedLedgerKobo: review.invoiceReview.totals.approvedKobo + review.cashReview.totals.bankedCashKobo + review.manualTotals.reviewedKobo,
  };
  return { ...review.invoiceReview, totals, unresolvedBank: review.unresolvedBank,
  invoices: state.invoices, bank: state.bank, approved: state.approved,
  cashbook, cashAllocations, cashReview: review.cashReview, manualResolutions: review.manualResolutions,
  closeBlockers: review.closeBlockers, stockReview: reconcileStock(state.stock || []),
  reviewCycle: state.reviewCycle || { title: 'Current review', startedAt: state.updatedAt }, reviewHistory: state.reviewHistory || [],
  version: state.version, imports: state.imports, briefs: state.briefs || {}, agentAnswers: state.agentAnswers || [], intakeDraft: state.intakeDraft || null,
  audit: state.audit || [], updatedAt: state.updatedAt,
  demo: { isDemo, limits: DEMO_LIMITS, usage: { intake: 0, investigate: 0, agent: 0, ...(state.demoUsage || {}) } },
  };
};
const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: INTAKE_LIMITS.files, fileSize: INTAKE_LIMITS.fileBytes, fields: 4, fieldSize: INTAKE_LIMITS.textCharacters * 2 },
});

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function reviewedIntakeRows(requested, draft, existingInvoices, existingCashbook) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 100) {
    const error = new Error('Select between 1 and 100 extracted sales records'); error.status = 400; throw error;
  }
  const candidates = new Map((draft?.candidates || []).map(row => [row.draftId, row]));
  const usedInvoiceIds = new Set(existingInvoices.map(row => row.id));
  const usedCashIds = new Set(existingCashbook.map(row => row.id));
  const offsets = { invoice: existingInvoices.length, cash_sale: existingCashbook.length };
  return requested.map((row, index) => {
    const source = candidates.get(row?.draftId);
    if (!source) { const error = new Error('An extracted row is no longer in the current draft'); error.status = 409; throw error; }
    const recordType = row.recordType === 'cash_sale' ? 'cash_sale' : 'invoice';
    const usedIds = recordType === 'cash_sale' ? usedCashIds : usedInvoiceIds;
    const id = String(row.invoiceId || '').trim().slice(0, 80);
    const date = String(row.date || '').trim();
    const customer = String(row.customer || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const amountKobo = Number(row.amountKobo);
    if (!id || usedIds.has(id)) { const error = new Error(`Row ${index + 1}: record ID is missing or already used`); error.status = 400; throw error; }
    if (!validDate(date)) { const error = new Error(`Row ${index + 1}: confirm a valid date`); error.status = 400; throw error; }
    if (!customer) { const error = new Error(`Row ${index + 1}: confirm the customer`); error.status = 400; throw error; }
    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) { const error = new Error(`Row ${index + 1}: confirm a positive NGN amount`); error.status = 400; throw error; }
    usedIds.add(id);
    return {
      recordType, record: { id, date, customer, amountKobo, sourceRow: offsets[recordType] + index + 2,
      description: source.description || '',
      sourceType: source.sourceType, sourceName: source.sourceLabel,
      sourceHash: source.sourceHash, sourceLocator: source.sourceLocator,
      confidence: source.confidence, extractionModel: source.extractionModel },
    };
  });
}

export function createApp({ verifyToken, store, investigate = investigateWithMeta, extractIntake = extractInvoiceIntake, ragAgent = createRagAgent() }) {
  const app = express();
  app.set('trust proxy', 1);
  const publicDemoBuckets = new Map();
  const consumePublicDemoRequest = req => {
    const key = String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 160);
    const now = Date.now();
    const existing = publicDemoBuckets.get(key);
    const bucket = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + 60 * 60 * 1000 } : existing;
    if (bucket.count >= 20) {
      const error = new Error('Public Judge Demo traffic limit reached. Please try again later.'); error.status = 429; throw error;
    }
    bucket.count += 1;
    publicDemoBuckets.set(key, bucket);
    if (publicDemoBuckets.size > 2_000) {
      for (const [bucketKey, value] of publicDemoBuckets) if (value.resetAt <= now) publicDemoBuckets.delete(bucketKey);
    }
  };
  const consumeDemoModelCall = async (req, kind) => {
    if (!req.isAnonymous) return;
    consumePublicDemoRequest(req);
    await store.consumeDemoQuota(req.uid, kind, DEMO_LIMITS[kind]);
  };
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.get('/firebase-config.js', (_req, res) => {
    const projectId = process.env.FIREBASE_PROJECT_ID || '';
    const config = {
      apiKey: process.env.FIREBASE_WEB_API_KEY || '',
      projectId,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      appId: process.env.FIREBASE_WEB_APP_ID || '',
    };
    res.set('Cache-Control', 'no-store').type('application/javascript')
      .send(`window.__NAIJALEDGER_FIREBASE__=${JSON.stringify(config).replaceAll('<', '\\u003c')};`);
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', route(async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
    if (!match) return res.status(401).json({ error: 'Sign in to continue' });
    try {
      const identity = await verifyToken(match[1]);
      req.uid = typeof identity === 'string' ? identity : identity?.uid;
      req.isAnonymous = typeof identity === 'object' && identity?.isAnonymous === true;
      if (!req.uid) throw new Error('Invalid identity');
      req.actor = actorSnapshot(typeof identity === 'string' ? { uid: identity, isAnonymous: false } : identity);
      next();
    }
    catch { res.status(401).json({ error: 'Session expired; sign in again' }); }
  }));
  app.get('/api/workspace', route(async (req, res) => res.json(view(await store.get(req.uid), req.isAnonymous))));
  app.post('/api/demo/reset', route(async (req, res) => {
    if (!req.isAnonymous) return res.status(403).json({ error: 'Reset sample is available only in Judge Demo' });
    const state = await store.change(req.uid, req.body?.version, current => {
      const resetAt = new Date().toISOString();
      return {
        ...seedWorkspace(),
        demoUsage: current.demoUsage || { intake: 0, investigate: 0, agent: 0 },
        audit: [{ action: 'demo-reset', at: resetAt, by: req.uid, actor: req.actor }],
        updatedAt: resetAt,
      };
    });
    res.json(view(state, true));
  }));
  app.post('/api/intake/extract', upload.array('files', INTAKE_LIMITS.files), route(async (req, res) => {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version)) return res.status(400).json({ error: 'Workspace version is required' });
    await consumeDemoModelCall(req, 'intake');
    const draft = await extractIntake(req.files || [], req.body?.text || '');
    const state = await store.change(req.uid, version, current => {
      current.intakeDraft = draft;
      current.audit = [...(current.audit || []), {
        action: 'intake-extracted', at: draft.createdAt,
        sources: draft.sources.length, rows: draft.candidates.length,
        sourceFingerprint: draft.sourceFingerprint,
        by: req.uid, actor: req.actor,
      }].slice(-100);
      return current;
    });
    res.json(view(state, req.isAnonymous));
  }));
  app.post('/api/intake/commit', route(async (req, res) => {
    const { draftId, rows, version } = req.body || {};
    const state = await store.change(req.uid, version, current => {
      if (!current.intakeDraft || current.intakeDraft.id !== draftId) {
        const error = new Error('The extraction draft changed; review the current draft'); error.status = 409; throw error;
      }
      const accepted = reviewedIntakeRows(rows, current.intakeDraft, current.invoices, current.cashbook || []);
      const invoices = accepted.filter(row => row.recordType === 'invoice').map(row => row.record);
      const cashSales = accepted.filter(row => row.recordType === 'cash_sale').map(row => row.record);
      current.invoices = [...current.invoices, ...invoices];
      current.cashbook = [...(current.cashbook || []), ...cashSales];
      current.imports.invoices = sha256(JSON.stringify(current.invoices));
      current.imports.cashbook = sha256(JSON.stringify(current.cashbook));
      current.approved = current.approved || [];
      current.cashAllocations = current.cashAllocations || [];
      current.briefs = {};
      current.audit = [...(current.audit || []), {
        action: 'intake-committed', at: new Date().toISOString(), rows: accepted.length, invoices: invoices.length, cashSales: cashSales.length,
        sources: new Set(accepted.map(row => row.record.sourceHash)).size,
        sourceFingerprint: current.intakeDraft.sourceFingerprint,
        by: req.uid, actor: req.actor,
      }].slice(-100);
      current.intakeDraft = null;
      return current;
    });
    res.json(view(state, req.isAnonymous));
  }));
  app.post('/api/intake/discard', route(async (req, res) => {
    const { draftId, version } = req.body || {};
    const state = await store.change(req.uid, version, current => {
      if (!current.intakeDraft || current.intakeDraft.id !== draftId) {
        const error = new Error('The extraction draft changed; reload the workspace'); error.status = 409; throw error;
      }
      current.audit = [...(current.audit || []), { action: 'intake-discarded', at: new Date().toISOString(), sourceFingerprint: current.intakeDraft.sourceFingerprint, by: req.uid, actor: req.actor }].slice(-100);
      current.intakeDraft = null;
      return current;
    });
    res.json(view(state, req.isAnonymous));
  }));
  app.post('/api/import/:kind', route(async (req, res) => {
    const kind = req.params.kind;
    if (!['invoices', 'bank', 'cashbook', 'stock'].includes(kind) || typeof req.body?.csv !== 'string') return res.status(400).json({ error: 'Expected invoices, bank, cashbook or stock CSV' });
    const rows = parseCsv(req.body.csv, kind);
    const state = await store.change(req.uid, req.body.version, current => {
      if ((current[kind] || []).length > 0) {
        const error = new Error(`Complete the current review before replacing its ${kind} records. The completed period will remain in review history.`);
        error.status = 409;
        throw error;
      }
      current[kind] = rows;
      current.imports[kind] = sha256(req.body.csv);
      if (['invoices', 'bank'].includes(kind)) current.approved = [];
      if (['bank', 'cashbook'].includes(kind)) current.cashAllocations = [];
      current.briefs = {};
      if (kind === 'invoices') current.intakeDraft = null;
      current.audit = [...(current.audit || []), { action: 'imported', kind, rows: rows.length, sourceHash: current.imports[kind], at: new Date().toISOString(), by: req.uid, actor: req.actor }].slice(-100);
      return current;
    });
    res.json(view(state, req.isAnonymous));
  }));
  app.post('/api/approvals', route(async (req, res) => {
    const { invoiceId, bankId, version } = req.body || {};
    const state = await store.change(req.uid, version, current => {
      const proposal = calculateReview(current).invoiceReview.proposals
        .find(p => p.invoiceId === invoiceId && p.bankId === bankId);
      if (!proposal) { const error = new Error('Pair is not an available proposal'); error.status = 400; throw error; }
      current.approved.push({ invoiceId, bankId, reviewedAt: new Date().toISOString(), reviewedBy: req.uid, reviewer: req.actor });
      current.briefs = {};
      current.audit = [...(current.audit || []), { action: 'approved', invoiceId, bankId, by: req.uid, actor: req.actor, at: new Date().toISOString() }].slice(-100);
      return current;
    });
    res.json(view(state, req.isAnonymous));
  }));
  app.post('/api/cash-deposits', route(async (req, res) => {
    const { cashEntryIds, bankId, version } = req.body || {};
    const state = await store.change(req.uid, version, current => {
      const proposal = calculateReview(current).cashReview.proposals
        .find(row => row.bankId === bankId && JSON.stringify(row.cashEntryIds) === JSON.stringify(cashEntryIds));
      if (!proposal) { const error = new Error('Cash lodgement is not an available proposal'); error.status = 400; throw error; }
      current.cashAllocations = [...(current.cashAllocations || []), { cashEntryIds, bankId, reviewedAt: new Date().toISOString(), reviewedBy: req.uid, reviewer: req.actor, frequency: proposal.frequency }];
      current.audit = [...(current.audit || []), { action: 'cash-deposit-approved', bankId, cashEntryIds, rows: cashEntryIds.length, by: req.uid, actor: req.actor, at: new Date().toISOString() }].slice(-100);
      return current;
    });
    res.json(view(state, req.isAnonymous));
  }));
  app.post('/api/resolutions', route(async (req, res) => {
    const kind = req.body?.kind;
    const recordId = String(req.body?.recordId || '').trim().slice(0, 160);
    const comment = String(req.body?.comment || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (!['invoice', 'bank'].includes(kind) || !recordId) return res.status(400).json({ error: 'Select an unresolved invoice or bank entry' });
    if (comment.length < 5) return res.status(400).json({ error: 'Add a review comment of at least 5 characters before resolving this record' });
    const state = await store.change(req.uid, req.body?.version, current => {
      const review = calculateReview(current);
      const source = (kind === 'invoice' ? review.invoiceReview.unresolvedInvoices : review.unresolvedBank)
        .find(row => row.id === recordId);
      if (!source) { const error = new Error('This record is no longer unresolved; reload the current review'); error.status = 409; throw error; }
      const reviewedAt = new Date().toISOString();
      const resolution = {
        id: `resolution-${kind}-${recordId}-${reviewedAt.replace(/\D/g, '').slice(0, 14)}`,
        kind, recordId, amountKobo: source.amountKobo, comment, reviewedAt,
        reviewer: req.actor, metaInvestigated: kind === 'invoice' && Boolean(current.briefs?.[recordId]),
        sourceHash: current.imports?.[kind === 'invoice' ? 'invoices' : 'bank'] || null,
      };
      current.manualResolutions = [...(current.manualResolutions || []), resolution];
      current.audit = [...(current.audit || []), {
        action: 'exception-resolved', kind, recordId,
        ...(kind === 'invoice' ? { invoiceId: recordId } : { bankId: recordId }),
        amountKobo: source.amountKobo, comment, at: reviewedAt, by: req.uid, actor: req.actor,
        metaInvestigated: resolution.metaInvestigated,
      }].slice(-100);
      return current;
    });
    res.json(view(state, req.isAnonymous));
  }));
  app.post('/api/stock', route(async (req, res) => {
    const requested = req.body?.rows;
    if (!Array.isArray(requested) || requested.length > 200) return res.status(400).json({ error: 'Stock count must contain 0 to 200 items' });
    const ids = new Set();
    const rows = requested.map((row, index) => {
      const sku = String(row?.sku || '').trim().slice(0, 80);
      const item = String(row?.item || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const unit = String(row?.unit || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!sku || ids.has(sku) || !item || !unit) { const error = new Error(`Stock row ${index + 1}: confirm a unique SKU, item and unit`); error.status = 400; throw error; }
      ids.add(sku);
      const quantity = name => {
        const value = Number(row?.[name]);
        if (!Number.isFinite(value) || Math.abs(value) > 1_000_000 || (name !== 'adjustmentQty' && value < 0)) { const error = new Error(`Stock row ${index + 1}: invalid quantity`); error.status = 400; throw error; }
        return Math.round(value * 1000) / 1000;
      };
      return { sku, item, unit, openingQty: quantity('openingQty'), receivedQty: quantity('receivedQty'), soldQty: quantity('soldQty'), adjustmentQty: quantity('adjustmentQty'), countedQty: quantity('countedQty'), sourceRow: index + 2 };
    });
    const state = await store.change(req.uid, req.body?.version, current => {
      current.stock = rows; current.imports.stock = sha256(JSON.stringify(rows));
      current.audit = [...(current.audit || []), { action: 'stock-count-saved', rows: rows.length, by: req.uid, actor: req.actor, at: new Date().toISOString() }].slice(-100);
      return current;
    });
    res.json(view(state, req.isAnonymous));
  }));
  app.post('/api/review-cycles/complete', route(async (req, res) => {
    const title = String(req.body?.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!title) return res.status(400).json({ error: 'Name the completed review period' });
    const state = await store.change(req.uid, req.body?.version, current => {
      const review = calculateReview(current);
      if (review.closeBlockers.total > 0) {
        const error = new Error(`Resolve all review items first: ${review.closeBlockers.unresolvedInvoices} invoice exceptions, ${review.closeBlockers.unresolvedBank} bank exceptions, ${review.closeBlockers.invoiceProposals + review.closeBlockers.cashProposals} match proposals remain`);
        error.status = 400;
        throw error;
      }
      const completedAt = new Date().toISOString();
      const snapshot = reviewCycleSnapshot(current, title, completedAt, req.actor);
      current.reviewHistory = [...(current.reviewHistory || []), snapshot].slice(-12);
      current.invoices = []; current.bank = []; current.cashbook = []; current.stock = [];
      current.approved = []; current.cashAllocations = []; current.manualResolutions = []; current.briefs = {}; current.intakeDraft = null; current.imports = {};
      current.reviewCycle = { title: 'New review', startedAt: completedAt };
      current.audit = [{ action: 'review-cycle-started', at: completedAt, completedReviewId: snapshot.id, by: req.uid, actor: req.actor }];
      return current;
    });
    res.json(view(state, req.isAnonymous));
  }));
  app.post('/api/investigate', route(async (req, res) => {
    const { invoiceId, version } = req.body || {};
    if (typeof invoiceId !== 'string' || invoiceId.length > 160) return res.status(400).json({ error: 'Select an invoice' });
    const state = await store.get(req.uid);
    if (state.version !== version) return res.status(409).json({ error: 'Workspace changed; reload and review again' });
    const evidence = evidenceFor(state, invoiceId);
    await consumeDemoModelCall(req, 'investigate');
    const brief = await investigate(evidence);
    const saved = await store.saveBrief(req.uid, version, invoiceId, brief, req.actor);
    res.json({ invoiceId, brief, workspace: view(saved, req.isAnonymous) });
  }));
  app.post('/api/agent/query', route(async (req, res) => {
    const question = String(req.body?.question || '').replace(/\s+/g, ' ').trim();
    const version = Number(req.body?.version);
    if (question.length < 4 || question.length > 600) return res.status(400).json({ error: 'Ask a question between 4 and 600 characters' });
    const state = await store.get(req.uid);
    if (state.version !== version) return res.status(409).json({ error: 'Workspace changed; reload before asking the Evidence Agent' });
    await consumeDemoModelCall(req, 'agent');
    const answer = await ragAgent.answer({ uid: req.uid, state, question });
    const saved = await store.saveAgentAnswer(req.uid, version, answer, req.actor);
    res.json({ answer, workspace: view(saved, req.isAnonymous) });
  }));
  app.post('/api/agent/reviews', route(async (req, res) => {
    const { sourceFingerprint, createdAt, version } = req.body || {};
    if (typeof sourceFingerprint !== 'string' || typeof createdAt !== 'string') {
      return res.status(400).json({ error: 'Select a current Evidence Agent answer' });
    }
    const state = await store.reviewAgentAnswer(req.uid, version, sourceFingerprint, createdAt, req.actor);
    res.json(view(state, req.isAnonymous));
  }));
  app.post('/api/brief-reviews', route(async (req, res) => {
    const { invoiceId, sourceFingerprint, version } = req.body || {};
    if (typeof invoiceId !== 'string' || typeof sourceFingerprint !== 'string') {
      return res.status(400).json({ error: 'Select a current evidence brief' });
    }
    const state = await store.reviewBrief(req.uid, version, invoiceId, sourceFingerprint, req.actor);
    res.json(view(state, req.isAnonymous));
  }));
  app.get('/api/handover', route(async (req, res) => {
    const state = await store.get(req.uid);
    const report = createReviewPack(state);
    res.set('Content-Disposition', 'attachment; filename="naijaledger-review-pack.json"');
    res.json(report);
  }));
  app.get('/api/handover.pdf', route(async (req, res) => {
    const report = createReviewPack(await store.get(req.uid));
    const file = await buildReviewPdf(report);
    res.set({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="naijaledger-review-pack.pdf"',
      'Content-Length': String(file.length),
    }).send(file);
  }));
  app.get('/api/handover.xlsx', route(async (req, res) => {
    const report = createReviewPack(await store.get(req.uid));
    const file = await buildReviewWorkbook(report);
    res.set({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="naijaledger-review-pack.xlsx"',
      'Content-Length': String(file.length),
    }).send(file);
  }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(join(here, '../dist')));
  app.get('*', (_req, res) => res.sendFile(join(here, '../dist/index.html')));
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Each source file must be 15 MB or smaller' });
      if (error.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: `Choose no more than ${INTAKE_LIMITS.files} files` });
      return res.status(400).json({ error: 'The document upload could not be read' });
    }
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'CSV exceeds request limit' });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid JSON body' });
    if (error.name === 'TimeoutError') return res.status(504).json({ error: 'Meta investigation timed out' });
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (/^(Missing column|CSV |Row |Maximum |Invalid NGN|Amount |Unclosed |Malformed |Unknown import)/.test(error.message)) return res.status(400).json({ error: error.message });
    console.error('NaijaLedger request failed:', error);
    res.status(500).json({ error: 'Request failed; please retry' });
  });
  return app;
}

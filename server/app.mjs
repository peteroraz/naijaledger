import express from 'express';
import multer from 'multer';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, sha256 } from './csv.mjs';
import { extractInvoiceIntake, INTAKE_LIMITS } from './intake.mjs';
import { reconcile } from './reconcile.mjs';
import { evidenceFor, investigateWithMeta } from './meta.mjs';
import { buildReviewPdf, buildReviewWorkbook, createReviewPack } from './review-pack.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const view = state => ({ ...reconcile(state.invoices, state.bank, state.approved),
  invoices: state.invoices, bank: state.bank, approved: state.approved,
  version: state.version, imports: state.imports, briefs: state.briefs || {}, intakeDraft: state.intakeDraft || null,
  audit: state.audit || [], updatedAt: state.updatedAt });
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

function reviewedInvoiceRows(requested, draft, existing) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 100) {
    const error = new Error('Select between 1 and 100 extracted invoices'); error.status = 400; throw error;
  }
  const candidates = new Map((draft?.candidates || []).map(row => [row.draftId, row]));
  const usedIds = new Set(existing.map(row => row.id));
  return requested.map((row, index) => {
    const source = candidates.get(row?.draftId);
    if (!source) { const error = new Error('An extracted row is no longer in the current draft'); error.status = 409; throw error; }
    const id = String(row.invoiceId || '').trim().slice(0, 80);
    const date = String(row.date || '').trim();
    const customer = String(row.customer || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const amountKobo = Number(row.amountKobo);
    if (!id || usedIds.has(id)) { const error = new Error(`Row ${index + 1}: invoice ID is missing or already used`); error.status = 400; throw error; }
    if (!validDate(date)) { const error = new Error(`Row ${index + 1}: confirm a valid date`); error.status = 400; throw error; }
    if (!customer) { const error = new Error(`Row ${index + 1}: confirm the customer`); error.status = 400; throw error; }
    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) { const error = new Error(`Row ${index + 1}: confirm a positive NGN amount`); error.status = 400; throw error; }
    usedIds.add(id);
    return {
      id, date, customer, amountKobo, sourceRow: existing.length + index + 2,
      description: source.description || '',
      sourceType: source.sourceType, sourceName: source.sourceLabel,
      sourceHash: source.sourceHash, sourceLocator: source.sourceLocator,
      confidence: source.confidence, extractionModel: source.extractionModel,
    };
  });
}

export function createApp({ verifyToken, store, investigate = investigateWithMeta, extractIntake = extractInvoiceIntake }) {
  const app = express();
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
    try { req.uid = await verifyToken(match[1]); next(); }
    catch { res.status(401).json({ error: 'Session expired; sign in again' }); }
  }));
  app.get('/api/workspace', route(async (req, res) => res.json(view(await store.get(req.uid)))));
  app.post('/api/intake/extract', upload.array('files', INTAKE_LIMITS.files), route(async (req, res) => {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version)) return res.status(400).json({ error: 'Workspace version is required' });
    const draft = await extractIntake(req.files || [], req.body?.text || '');
    const state = await store.change(req.uid, version, current => {
      current.intakeDraft = draft;
      current.audit = [...(current.audit || []), {
        action: 'intake-extracted', at: draft.createdAt,
        sources: draft.sources.length, rows: draft.candidates.length,
        sourceFingerprint: draft.sourceFingerprint,
      }].slice(-100);
      return current;
    });
    res.json(view(state));
  }));
  app.post('/api/intake/commit', route(async (req, res) => {
    const { draftId, rows, version } = req.body || {};
    const state = await store.change(req.uid, version, current => {
      if (!current.intakeDraft || current.intakeDraft.id !== draftId) {
        const error = new Error('The extraction draft changed; review the current draft'); error.status = 409; throw error;
      }
      const accepted = reviewedInvoiceRows(rows, current.intakeDraft, current.invoices);
      current.invoices = [...current.invoices, ...accepted];
      current.imports.invoices = sha256(JSON.stringify(current.invoices));
      current.approved = current.approved || [];
      current.briefs = {};
      current.audit = [...(current.audit || []), {
        action: 'intake-committed', at: new Date().toISOString(), rows: accepted.length,
        sources: new Set(accepted.map(row => row.sourceHash)).size,
        sourceFingerprint: current.intakeDraft.sourceFingerprint,
        by: req.uid,
      }].slice(-100);
      current.intakeDraft = null;
      return current;
    });
    res.json(view(state));
  }));
  app.post('/api/intake/discard', route(async (req, res) => {
    const { draftId, version } = req.body || {};
    const state = await store.change(req.uid, version, current => {
      if (!current.intakeDraft || current.intakeDraft.id !== draftId) {
        const error = new Error('The extraction draft changed; reload the workspace'); error.status = 409; throw error;
      }
      current.audit = [...(current.audit || []), { action: 'intake-discarded', at: new Date().toISOString(), sourceFingerprint: current.intakeDraft.sourceFingerprint }].slice(-100);
      current.intakeDraft = null;
      return current;
    });
    res.json(view(state));
  }));
  app.post('/api/import/:kind', route(async (req, res) => {
    const kind = req.params.kind;
    if (!['invoices', 'bank'].includes(kind) || typeof req.body?.csv !== 'string') return res.status(400).json({ error: 'Expected invoices or bank CSV' });
    const rows = parseCsv(req.body.csv, kind);
    const state = await store.change(req.uid, req.body.version, current => {
      current[kind] = rows;
      current.imports[kind] = sha256(req.body.csv);
      current.approved = []; current.briefs = {};
      if (kind === 'invoices') current.intakeDraft = null;
      current.audit = [...(current.audit || []), { action: 'imported', kind, rows: rows.length, sourceHash: current.imports[kind], at: new Date().toISOString() }].slice(-100);
      return current;
    });
    res.json(view(state));
  }));
  app.post('/api/approvals', route(async (req, res) => {
    const { invoiceId, bankId, version } = req.body || {};
    const state = await store.change(req.uid, version, current => {
      const proposal = reconcile(current.invoices, current.bank, current.approved).proposals
        .find(p => p.invoiceId === invoiceId && p.bankId === bankId);
      if (!proposal) { const error = new Error('Pair is not an available proposal'); error.status = 400; throw error; }
      current.approved.push({ invoiceId, bankId, reviewedAt: new Date().toISOString(), reviewedBy: req.uid });
      current.briefs = {};
      current.audit = [...(current.audit || []), { action: 'approved', invoiceId, bankId, by: req.uid, at: new Date().toISOString() }].slice(-100);
      return current;
    });
    res.json(view(state));
  }));
  app.post('/api/investigate', route(async (req, res) => {
    const { invoiceId, version } = req.body || {};
    if (typeof invoiceId !== 'string' || invoiceId.length > 160) return res.status(400).json({ error: 'Select an invoice' });
    const state = await store.get(req.uid);
    if (state.version !== version) return res.status(409).json({ error: 'Workspace changed; reload and review again' });
    const evidence = evidenceFor(state, invoiceId);
    const brief = await investigate(evidence);
    const saved = await store.saveBrief(req.uid, version, invoiceId, brief);
    res.json({ invoiceId, brief, workspace: view(saved) });
  }));
  app.post('/api/brief-reviews', route(async (req, res) => {
    const { invoiceId, sourceFingerprint, version } = req.body || {};
    if (typeof invoiceId !== 'string' || typeof sourceFingerprint !== 'string') {
      return res.status(400).json({ error: 'Select a current evidence brief' });
    }
    const state = await store.reviewBrief(req.uid, version, invoiceId, sourceFingerprint);
    res.json(view(state));
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

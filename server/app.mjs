import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, sha256 } from './csv.mjs';
import { reconcile } from './reconcile.mjs';
import { evidenceFor, investigateWithMeta } from './meta.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const view = state => ({ ...reconcile(state.invoices, state.bank, state.approved),
  invoices: state.invoices, bank: state.bank, approved: state.approved,
  version: state.version, imports: state.imports, briefs: state.briefs || {}, audit: state.audit || [], updatedAt: state.updatedAt });
const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);

export function createApp({ verifyToken, store, investigate = investigateWithMeta }) {
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
  app.post('/api/import/:kind', route(async (req, res) => {
    const kind = req.params.kind;
    if (!['invoices', 'bank'].includes(kind) || typeof req.body?.csv !== 'string') return res.status(400).json({ error: 'Expected invoices or bank CSV' });
    const rows = parseCsv(req.body.csv, kind);
    const state = await store.change(req.uid, req.body.version, current => {
      current[kind] = rows;
      current.imports[kind] = sha256(req.body.csv);
      current.approved = []; current.briefs = {};
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
    const report = {
      title: 'NaijaLedger review pack', generatedAt: new Date().toISOString(),
      status: 'Human review required; not a tax filing or accounting certification',
      sourceHashes: state.imports, workspaceVersion: state.version,
      ...view(state),
    };
    res.set('Content-Disposition', 'attachment; filename="naijaledger-review-pack.json"');
    res.json(report);
  }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(join(here, '../dist')));
  app.get('*', (_req, res) => res.sendFile(join(here, '../dist/index.html')));
  app.use((error, _req, res, _next) => {
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

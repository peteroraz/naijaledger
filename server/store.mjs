import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, sha256 } from './csv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const samples = Object.fromEntries(['invoices', 'bank', 'cashbook', 'stock'].map(kind => [kind, readFileSync(join(here, `../samples/${kind}.csv`), 'utf8')]));

export function seedWorkspace() {
  return {
    invoices: parseCsv(samples.invoices, 'invoices'),
    bank: parseCsv(samples.bank, 'bank'),
    cashbook: parseCsv(samples.cashbook, 'cashbook'),
    stock: parseCsv(samples.stock, 'stock'),
    approved: [], cashAllocations: [], manualResolutions: [], briefs: {}, agentAnswers: [], intakeDraft: null, audit: [], reviewHistory: [], version: 0,
    reviewCycle: { title: 'October 2026 operating review', startedAt: '2026-10-01T00:00:00.000Z' },
    imports: { invoices: sha256(samples.invoices), bank: sha256(samples.bank), cashbook: sha256(samples.cashbook), stock: sha256(samples.stock) },
    updatedAt: new Date().toISOString(),
  };
}

// All access is through the Admin SDK after an ID token is verified. The UID is
// never supplied in a path or request body by the browser.
export function createFirestoreStore(db) {
  const ref = uid => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Invalid user ID');
    return db.collection('users').doc(uid).collection('workspaces').doc('default');
  };
  return {
    async get(uid) {
      const doc = ref(uid);
      let snap = await doc.get();
      if (!snap.exists) {
        try { await doc.create(seedWorkspace()); }
        catch (error) { if (error.code !== 6 && error.code !== 'already-exists') throw error; }
        snap = await doc.get();
      }
      return snap.data();
    },
    async change(uid, expectedVersion, mutation) {
      return db.runTransaction(async tx => {
        const doc = ref(uid);
        const snap = await tx.get(doc);
        const current = snap.exists ? snap.data() : seedWorkspace();
        if (current.version !== expectedVersion) {
          const error = new Error('Workspace changed; reload and review again');
          error.status = 409;
          throw error;
        }
        const next = mutation(structuredClone(current));
        next.version = current.version + 1;
        next.updatedAt = new Date().toISOString();
        tx.set(doc, next);
        return next;
      });
    },
    async consumeDemoQuota(uid, kind, limit) {
      if (!['intake', 'investigate', 'agent'].includes(kind) || !Number.isInteger(limit) || limit < 1) throw new Error('Invalid demo quota');
      return db.runTransaction(async tx => {
        const doc = ref(uid);
        const snap = await tx.get(doc);
        const state = snap.exists ? snap.data() : seedWorkspace();
        const usage = { intake: 0, investigate: 0, agent: 0, ...(state.demoUsage || {}) };
        if (usage[kind] >= limit) {
          const label = kind === 'intake' ? 'Smart Intake extractions' : kind === 'agent' ? 'Evidence Agent questions' : 'Meta investigations';
          const error = new Error(`Judge Demo limit reached for ${label}. Resetting the sample does not reset model allowances.`);
          error.status = 429;
          throw error;
        }
        usage[kind] += 1;
        state.demoUsage = usage;
        tx.set(doc, state);
        return usage;
      });
    },
    async saveBrief(uid, expectedVersion, invoiceId, brief, actor = { uid }) {
      return db.runTransaction(async tx => {
        const doc = ref(uid);
        const snap = await tx.get(doc);
        if (!snap.exists || snap.data().version !== expectedVersion) {
          const error = new Error('Workspace changed during investigation; retry with current records');
          error.status = 409;
          throw error;
        }
        const state = snap.data();
        if (!state.invoices.some(row => row.id === invoiceId)) {
          const error = new Error('Invoice no longer exists'); error.status = 409; throw error;
        }
        state.briefs = { ...state.briefs, [invoiceId]: brief };
        const oldest = Object.entries(state.briefs).sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));
        for (const [id] of oldest.slice(0, Math.max(0, oldest.length - 20))) delete state.briefs[id];
        state.audit = [...(state.audit || []), { action: 'investigated', invoiceId, at: brief.createdAt, sourceFingerprint: brief.sourceFingerprint, by: uid, actor }].slice(-100);
        tx.set(doc, state);
        return state;
      });
    },
    async saveAgentAnswer(uid, expectedVersion, answer, actor = { uid }) {
      return db.runTransaction(async tx => {
        const doc = ref(uid);
        const snap = await tx.get(doc);
        if (!snap.exists || snap.data().version !== expectedVersion) {
          const error = new Error('Workspace changed during retrieval; ask again with current records');
          error.status = 409;
          throw error;
        }
        const state = snap.data();
        state.agentAnswers = [...(state.agentAnswers || []), answer].slice(-8);
        state.audit = [...(state.audit || []), {
          action: 'rag-asked', at: answer.createdAt, question: answer.question.slice(0, 160),
          sourceFingerprint: answer.sourceFingerprint, retrievalMode: answer.retrieval?.mode, by: uid, actor,
        }].slice(-100);
        tx.set(doc, state);
        return state;
      });
    },
    async reviewAgentAnswer(uid, expectedVersion, sourceFingerprint, createdAt, actor = { uid }) {
      return db.runTransaction(async tx => {
        const doc = ref(uid);
        const snap = await tx.get(doc);
        if (!snap.exists || snap.data().version !== expectedVersion) {
          const error = new Error('Workspace changed; reload before confirming the Evidence Agent review');
          error.status = 409;
          throw error;
        }
        const state = snap.data();
        const answer = (state.agentAnswers || []).find(item => item.sourceFingerprint === sourceFingerprint && item.createdAt === createdAt);
        if (!answer) {
          const error = new Error('Evidence Agent answer changed; ask again before signing off');
          error.status = 409;
          throw error;
        }
        const reviewedAt = new Date().toISOString();
        answer.verification = answer.verification || {};
        answer.verification.humanReview = { status: 'reviewed', reviewedAt, reviewedBy: uid, reviewer: actor };
        state.version += 1;
        state.updatedAt = reviewedAt;
        state.audit = [...(state.audit || []), {
          action: 'rag-reviewed', at: reviewedAt, by: uid, actor, sourceFingerprint,
        }].slice(-100);
        tx.set(doc, state);
        return state;
      });
    },
    async reviewBrief(uid, expectedVersion, invoiceId, sourceFingerprint, actor = { uid }) {
      return db.runTransaction(async tx => {
        const doc = ref(uid);
        const snap = await tx.get(doc);
        if (!snap.exists || snap.data().version !== expectedVersion) {
          const error = new Error('Workspace changed; reload before signing off');
          error.status = 409;
          throw error;
        }
        const state = snap.data();
        const brief = state.briefs?.[invoiceId];
        if (!brief || brief.sourceFingerprint !== sourceFingerprint) {
          const error = new Error('Evidence brief changed; investigate again before signing off');
          error.status = 409;
          throw error;
        }
        const reviewedAt = new Date().toISOString();
        brief.verification = brief.verification || {};
        brief.verification.humanReview = { status: 'reviewed', reviewedAt, reviewedBy: uid, reviewer: actor };
        state.version += 1;
        state.updatedAt = reviewedAt;
        state.audit = [...(state.audit || []), {
          action: 'brief-reviewed', invoiceId, at: reviewedAt,
          by: uid, actor, sourceFingerprint,
        }].slice(-100);
        tx.set(doc, state);
        return state;
      });
    },
  };
}

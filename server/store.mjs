import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, sha256 } from './csv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const samples = Object.fromEntries(['invoices', 'bank'].map(kind => [kind, readFileSync(join(here, `../samples/${kind}.csv`), 'utf8')]));

export function seedWorkspace() {
  return {
    invoices: parseCsv(samples.invoices, 'invoices'),
    bank: parseCsv(samples.bank, 'bank'),
    approved: [], briefs: {}, intakeDraft: null, audit: [], version: 0,
    imports: { invoices: sha256(samples.invoices), bank: sha256(samples.bank) },
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
    async saveBrief(uid, expectedVersion, invoiceId, brief) {
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
        state.audit = [...(state.audit || []), { action: 'investigated', invoiceId, at: brief.createdAt, sourceFingerprint: brief.sourceFingerprint }].slice(-100);
        tx.set(doc, state);
        return state;
      });
    },
    async reviewBrief(uid, expectedVersion, invoiceId, sourceFingerprint) {
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
        brief.verification.humanReview = { status: 'reviewed', reviewedAt, reviewedBy: uid };
        state.version += 1;
        state.updatedAt = reviewedAt;
        state.audit = [...(state.audit || []), {
          action: 'brief-reviewed', invoiceId, at: reviewedAt,
          by: uid, sourceFingerprint,
        }].slice(-100);
        tx.set(doc, state);
        return state;
      });
    },
  };
}

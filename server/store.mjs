import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parseCsv, sha256 } from './csv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const samples = Object.fromEntries(['invoices', 'bank', 'cashbook', 'stock'].map(kind => [kind, readFileSync(join(here, `../samples/${kind}.csv`), 'utf8')]));
const STORAGE_VERSION = 2;
const CHUNK_CHARACTERS = 600_000;
const MAX_AUDIT_EVENTS = 1_000;

export function seedWorkspace({ sample = true } = {}) {
  const rows = sample ? {
    invoices: parseCsv(samples.invoices, 'invoices'), bank: parseCsv(samples.bank, 'bank'),
    cashbook: parseCsv(samples.cashbook, 'cashbook'), stock: parseCsv(samples.stock, 'stock'),
  } : { invoices: [], bank: [], cashbook: [], stock: [] };
  const updatedAt = new Date().toISOString();
  return {
    ...rows,
    approved: [], cashAllocations: [], rejectedProposals: [], manualResolutions: [], briefs: {}, agentAnswers: [], intakeDraft: null,
    audit: [], reviewHistory: [], version: 0,
    reviewCycle: { title: sample ? 'October 2026 operating review' : 'New review', startedAt: sample ? '2026-10-01T00:00:00.000Z' : updatedAt },
    imports: sample ? { invoices: sha256(samples.invoices), bank: sha256(samples.bank), cashbook: sha256(samples.cashbook), stock: sha256(samples.stock) } : {},
    updatedAt,
  };
}

const appendAudit = (state, event) => { state.audit = [...(state.audit || []), event].slice(-MAX_AUDIT_EVENTS); };

function encodeState(state) {
  const payload = gzipSync(Buffer.from(JSON.stringify(state))).toString('base64');
  const chunks = [];
  for (let offset = 0; offset < payload.length; offset += CHUNK_CHARACTERS) chunks.push(payload.slice(offset, offset + CHUNK_CHARACTERS));
  return { chunks, checksum: sha256(payload) };
}

function decodeState(metadata, snapshots) {
  const payload = snapshots.map(snapshot => snapshot.data()?.payload || '').join('');
  if (!payload || sha256(payload) !== metadata.checksum) throw new Error('Workspace storage checksum mismatch; retry the request');
  return JSON.parse(gunzipSync(Buffer.from(payload, 'base64')).toString('utf8'));
}

const chunkId = index => String(index).padStart(4, '0');

// All access is through the Admin SDK after an ID token is verified. State is
// compressed and split across bounded documents to avoid Firestore's 1 MiB
// single-document limit while retaining atomic, versioned review decisions.
export function createFirestoreStore(db) {
  const ref = uid => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Invalid user ID');
    return db.collection('users').doc(uid).collection('workspaces').doc('default');
  };
  const chunkRefs = (doc, count) => Array.from({ length: count }, (_, index) => doc.collection('chunks').doc(chunkId(index)));

  async function stateFromDocument(doc, snap, reader) {
    if (!snap.exists) return null;
    const metadata = snap.data();
    if (metadata.storageVersion !== STORAGE_VERSION) return metadata;
    const snapshots = [];
    for (const chunk of chunkRefs(doc, metadata.chunkCount || 0)) snapshots.push(await reader(chunk));
    if (snapshots.some(chunk => !chunk.exists)) throw new Error('Workspace storage is incomplete; retry the request');
    return decodeState(metadata, snapshots);
  }

  function writeState(tx, doc, state, previousChunkCount = 0) {
    const encoded = encodeState(state);
    tx.set(doc, { storageVersion: STORAGE_VERSION, chunkCount: encoded.chunks.length, checksum: encoded.checksum, version: state.version, updatedAt: state.updatedAt });
    encoded.chunks.forEach((payload, index) => tx.set(doc.collection('chunks').doc(chunkId(index)), { payload }));
    for (let index = encoded.chunks.length; index < previousChunkCount; index += 1) tx.delete(doc.collection('chunks').doc(chunkId(index)));
  }

  async function transact(uid, expectedVersion, mutation, { bumpVersion = false, missingSample = false } = {}) {
    return db.runTransaction(async tx => {
      const doc = ref(uid);
      const snap = await tx.get(doc);
      const metadata = snap.exists ? snap.data() : null;
      const previousChunkCount = metadata?.storageVersion === STORAGE_VERSION ? metadata.chunkCount || 0 : 0;
      const current = snap.exists ? await stateFromDocument(doc, snap, chunk => tx.get(chunk)) : seedWorkspace({ sample: missingSample });
      if (expectedVersion != null && current.version !== expectedVersion) {
        const error = new Error('Workspace changed; reload and review again'); error.status = 409; throw error;
      }
      const next = await mutation(structuredClone(current));
      if (bumpVersion) { next.version = current.version + 1; next.updatedAt = new Date().toISOString(); }
      writeState(tx, doc, next, previousChunkCount);
      return next;
    });
  }

  return {
    async get(uid, sample = true) {
      const doc = ref(uid);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let snap = await doc.get();
        if (!snap.exists) {
          try { await doc.create(seedWorkspace({ sample })); }
          catch (error) { if (error.code !== 6 && error.code !== 'already-exists') throw error; }
          snap = await doc.get();
        }
        try { return await stateFromDocument(doc, snap, chunk => chunk.get()); }
        catch (error) { if (attempt === 1) throw error; }
      }
      throw new Error('Workspace could not be loaded');
    },
    async change(uid, expectedVersion, mutation) {
      return transact(uid, expectedVersion, mutation, { bumpVersion: true });
    },
    async consumeDemoQuota(uid, kind, limit) {
      if (!['intake', 'investigate', 'agent'].includes(kind) || !Number.isInteger(limit) || limit < 1) throw new Error('Invalid demo quota');
      let usage;
      await transact(uid, null, state => {
        usage = { intake: 0, investigate: 0, agent: 0, ...(state.demoUsage || {}) };
        if (usage[kind] >= limit) {
          const label = kind === 'intake' ? 'Smart Intake extractions' : kind === 'agent' ? 'Evidence Agent questions' : 'Meta investigations';
          const error = new Error(`Judge Demo limit reached for ${label}. Resetting the sample does not reset model allowances.`); error.status = 429; throw error;
        }
        usage[kind] += 1; state.demoUsage = usage; return state;
      }, { missingSample: true });
      return usage;
    },
    async saveBrief(uid, expectedVersion, invoiceId, brief, actor = { uid }) {
      return transact(uid, expectedVersion, state => {
        if (!state.invoices.some(row => row.id === invoiceId)) { const error = new Error('Invoice no longer exists'); error.status = 409; throw error; }
        state.briefs = { ...state.briefs, [invoiceId]: brief };
        const oldest = Object.entries(state.briefs).sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));
        for (const [id] of oldest.slice(0, Math.max(0, oldest.length - 20))) delete state.briefs[id];
        appendAudit(state, { action: 'investigated', invoiceId, at: brief.createdAt, sourceFingerprint: brief.sourceFingerprint, by: uid, actor });
        return state;
      });
    },
    async saveAgentAnswer(uid, expectedVersion, answer, actor = { uid }) {
      return transact(uid, expectedVersion, state => {
        state.agentAnswers = [...(state.agentAnswers || []), answer].slice(-12);
        appendAudit(state, { action: 'rag-asked', at: answer.createdAt, question: answer.question.slice(0, 160), sourceFingerprint: answer.sourceFingerprint, retrievalMode: answer.retrieval?.mode, by: uid, actor });
        return state;
      });
    },
    async reviewAgentAnswer(uid, expectedVersion, sourceFingerprint, createdAt, actor = { uid }) {
      return transact(uid, expectedVersion, state => {
        const answer = (state.agentAnswers || []).find(item => item.sourceFingerprint === sourceFingerprint && item.createdAt === createdAt);
        if (!answer) { const error = new Error('Evidence Agent answer changed; ask again before signing off'); error.status = 409; throw error; }
        const reviewedAt = new Date().toISOString();
        answer.verification = answer.verification || {};
        answer.verification.humanReview = { status: 'reviewed', reviewedAt, reviewedBy: uid, reviewer: actor };
        appendAudit(state, { action: 'rag-reviewed', at: reviewedAt, by: uid, actor, sourceFingerprint });
        return state;
      }, { bumpVersion: true });
    },
    async reviewBrief(uid, expectedVersion, invoiceId, sourceFingerprint, actor = { uid }) {
      return transact(uid, expectedVersion, state => {
        const brief = state.briefs?.[invoiceId];
        if (!brief || brief.sourceFingerprint !== sourceFingerprint) { const error = new Error('Evidence brief changed; investigate again before signing off'); error.status = 409; throw error; }
        const reviewedAt = new Date().toISOString();
        brief.verification = brief.verification || {};
        brief.verification.humanReview = { status: 'reviewed', reviewedAt, reviewedBy: uid, reviewer: actor };
        appendAudit(state, { action: 'brief-reviewed', invoiceId, at: reviewedAt, by: uid, actor, sourceFingerprint });
        return state;
      }, { bumpVersion: true });
    },
  };
}

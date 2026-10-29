import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, firebaseReady } from './firebase';
import './style.css';

type Row = { id: string; date: string; amountKobo: number; sourceRow: number; customer?: string; description?: string };
type Match = { invoiceId: string; bankId: string; amountKobo: number; reason?: string };
type Verification = {
  status: 'checks_passed' | 'human_review_required'; checkedAt: string;
  checks: { id: string; label: string; passed: boolean; detail: string }[];
  modelReview: { model: string; verdict: 'supported' | 'needs_review' | 'unavailable' | 'skipped'; checkedClaims: number; issues: { claim: string; reason: string; evidenceIds: string[] }[] };
  attempts: { generation: number; verifier: number; maximum: number };
  humanReview: { status: 'pending' | 'reviewed'; reviewedAt?: string; reviewedBy?: string };
};
type Brief = {
  summary: string; hypotheses: { explanation: string; evidenceIds: string[]; nextStep: string; confidence: 'low' | 'medium' }[];
  missingEvidence: string[]; model: string; status: string; sourceFingerprint: string; createdAt: string;
  verification?: Verification;
};
type IntakeSource = {
  id: string; name: string; type: string; mimeType: string; sha256: string; size: number;
  status: 'extracted' | 'failed'; summary?: string; preview?: string; entryCount: number; error?: string; pipeline?: string;
};
type IntakeCandidate = {
  draftId: string; invoiceId: string; date: string; customer: string; amountKobo: number; description: string;
  confidence: 'high' | 'medium' | 'low'; sourceId: string; sourceLabel: string; sourceType: string;
  sourceHash: string; sourceLocator: string; warnings: string[]; extractionModel: string;
};
type IntakeDraft = {
  id: string; createdAt: string; model: string; voiceModel: string; sourceFingerprint: string;
  sources: IntakeSource[]; candidates: IntakeCandidate[]; status: 'awaiting_human_review';
};
type Workspace = {
  invoices: Row[]; bank: Row[]; proposals: Match[]; matches: Match[]; unresolvedInvoices: Row[]; unresolvedBank: Row[];
  totals: { invoicedKobo: number; bankCreditsKobo: number; approvedKobo: number };
  version: number; imports: Record<string, string>; briefs: Record<string, Brief>; intakeDraft: IntakeDraft | null; updatedAt: string;
  audit: { action: string; kind?: string; rows?: number; sources?: number; invoiceId?: string; bankId?: string; at: string }[];
};
const money = (n: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(n / 100);
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function api<T>(user: User, path: string, options: RequestInit = {}): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}

async function downloadApiFile(user: User, path: string, filename: string) {
  const token = await user.getIdToken();
  const response = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function activityText(event: Workspace['audit'][number]) {
  if (event.action === 'imported') return `Imported ${event.rows} ${event.kind} rows`;
  if (event.action === 'intake-extracted') return `Meta extracted ${event.rows} candidates from ${event.sources} sources`;
  if (event.action === 'intake-committed') return `Added ${event.rows} human-reviewed invoices`;
  if (event.action === 'intake-discarded') return 'Discarded a document extraction draft';
  if (event.action === 'approved') return `Approved ${event.invoiceId} ↔ ${event.bankId}`;
  if (event.action === 'brief-reviewed') return `Human reviewed ${event.invoiceId} evidence brief`;
  return `Investigated and verified ${event.invoiceId}`;
}

function Brand() {
  return <div className="brand"><div className="icon">₦</div><div><b>NaijaLedger</b><small>Clarity for every naira</small></div></div>;
}

function Welcome() {
  const [error, setError] = useState('');
  async function login() {
    if (!auth) return;
    setError('');
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { setError((e as Error).message); }
  }
  return <main className="welcome">
    <header><Brand /><span className="tag">Private workspace · Beta</span></header>
    <div className="welcome-grid">
      <section><p className="eyebrow">MEET YOUR RECONCILIATION COPILOT</p>
        <h1>Find the story <br />behind every <span>payment.</span></h1>
        <p className="welcome-lede">Connect sales to bank credits, review discrepancies, and turn uncertainty into a source-backed next step.</p>
        <div className="welcome-points"><span>01 · Capture any sales record</span><span>02 · Review exact matches</span><span>03 · Investigate with Muse Spark</span></div>
      </section>
      <section className="welcome-card"><div className="welcome-mark">₦</div><p className="eyebrow">YOUR SECURE SPACE</p>
        <h2>Start with a sample business.</h2>
        <p>We’ll load synthetic sales and bank records into your own persistent workspace. Your approvals and AI briefs remain available after you return.</p>
        {firebaseReady ? <button className="primary-large" onClick={() => void login()}>Continue with Google <span>→</span></button>
          : <div className="setup-note" role="status">Firebase is not configured yet. Add the web app values in <code>.env.local</code>, then restart Vite. See README setup.</div>}
        {error && <div className="error" role="alert">{error}</div>}
        <small>Financial data is sent to Meta only when you select “Investigate with Meta”.</small>
      </section>
    </div>
    <footer>NaijaLedger · A human reviews every allocation</footer>
  </main>;
}

function EvidenceBrief({ brief, bank, onReview, reviewing }: { brief: Brief; bank: Row[]; onReview: () => void; reviewing: boolean }) {
  const cited = (id: string) => bank.find(row => row.id === id);
  return <div className="brief" aria-label="Meta evidence brief">
    <div className="brief-heading"><span className="spark">✦</span><div><strong>Muse Spark evidence brief</strong><small>Unverified hypothesis · {new Date(brief.createdAt).toLocaleString('en-NG')}</small></div><span className="model-badge">{brief.model}</span></div>
    <p className="brief-summary">{brief.summary}</p>
    <div className="hypothesis-grid">{brief.hypotheses.map((h, i) => <article className="hypothesis" key={i}>
      <div className="hypothesis-top"><span>Hypothesis {String(i + 1).padStart(2, '0')}</span><em>{h.confidence} confidence</em></div>
      <p>{h.explanation}</p>
      {h.evidenceIds.length > 0 && <div className="evidence-ids">{h.evidenceIds.map(id => {
        const record = cited(id);
        return <span key={id} title={record?.description}>{id} · {record ? money(record.amountKobo) : 'source row'}</span>;
      })}</div>}
      <div className="next-step"><small>NEXT CHECK</small><p>{h.nextStep}</p></div>
    </article>)}</div>
    {brief.missingEvidence.length > 0 && <div className="missing"><strong>Evidence still needed</strong><ul>{brief.missingEvidence.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    {brief.verification && <section className={`receipt ${brief.verification.status}`} aria-label="Verification receipt">
      <div className="receipt-head"><div><small>VERIFICATION RECEIPT</small><strong>{brief.verification.status === 'checks_passed' ? 'Automated checks passed' : 'Human attention required'}</strong></div><span>{brief.verification.checks.filter(check => check.passed).length}/{brief.verification.checks.length} deterministic checks</span></div>
      <div className="check-grid">{brief.verification.checks.map(check => <div className={check.passed ? 'check pass' : 'check fail'} key={check.id}><b>{check.passed ? '✓' : '!'}</b><div><strong>{check.label}</strong><p>{check.detail}</p></div></div>)}</div>
      <div className="verifier-row"><div><small>INDEPENDENT MUSE REVIEW</small><strong>{brief.verification.modelReview.verdict === 'supported' ? 'Groundedness supported' : brief.verification.modelReview.verdict === 'needs_review' ? 'Claims need review' : 'Verifier did not complete'}</strong><p>{brief.verification.modelReview.checkedClaims} claims checked · Generation attempt {brief.verification.attempts.generation}/{brief.verification.attempts.maximum}</p></div><span className={`verdict ${brief.verification.modelReview.verdict}`}>{brief.verification.modelReview.verdict.replace('_', ' ')}</span></div>
      {brief.verification.modelReview.issues.length > 0 && <div className="verification-issues">{brief.verification.modelReview.issues.map((issue, i) => <p key={i}><strong>{issue.claim}</strong> — {issue.reason}</p>)}</div>}
      <div className="human-signoff"><div><small>HUMAN CHECKPOINT</small><strong>{brief.verification.humanReview.status === 'reviewed' ? 'Brief reviewed by a person' : 'Review is still required'}</strong><p>This confirms the evidence brief was read. It does not approve a payment match or tax treatment.</p></div>{brief.verification.humanReview.status === 'reviewed' ? <span className="reviewed">✓ Reviewed {brief.verification.humanReview.reviewedAt && new Date(brief.verification.humanReview.reviewedAt).toLocaleString('en-NG')}</span> : <button disabled={reviewing} onClick={onReview}>{reviewing ? 'Saving review…' : 'Mark brief reviewed'}</button>}</div>
    </section>}
    <small className="provenance">Source fingerprint: {brief.sourceFingerprint.slice(0, 16)} · AI cannot approve matches or determine tax treatment.</small>
  </div>;
}

function Desk({ user }: { user: User }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [intakeFiles, setIntakeFiles] = useState<File[]>([]);
  const [intakeText, setIntakeText] = useState('');
  const [recording, setRecording] = useState(false);
  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set());
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream } | null>(null);
  const refresh = () => api<Workspace>(user, '/workspace').then(setData).catch(e => setError(e.message));
  useEffect(() => { void refresh(); }, [user.uid]);
  useEffect(() => {
    if (data?.intakeDraft) setSelectedDrafts(new Set(data.intakeDraft.candidates.map(row => row.draftId)));
    else setSelectedDrafts(new Set());
  }, [data?.intakeDraft?.id]);

  function addIntakeFiles(files: FileList | File[]) {
    setIntakeFiles(current => [...current, ...Array.from(files)].slice(0, 8));
  }

  async function toggleRecording() {
    setError('');
    if (recorderRef.current) {
      recorderRef.current.recorder.stop();
      recorderRef.current.stream.getTracks().forEach(track => track.stop());
      recorderRef.current = null;
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      const chunks: BlobPart[] = [];
      recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener('stop', () => {
        const type = recorder.mimeType || 'audio/webm';
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        addIntakeFiles([new File(chunks, `voice-entry-${Date.now()}.${extension}`, { type })]);
      }, { once: true });
      recorder.start();
      recorderRef.current = { recorder, stream };
      setRecording(true);
    } catch (e) {
      setError((e as Error).message || 'Microphone access was not granted');
    }
  }

  async function analyzeIntake() {
    if (!data || (!intakeFiles.length && !intakeText.trim())) return;
    setBusy('intake-analyze'); setError('');
    const form = new FormData();
    form.append('version', String(data.version));
    form.append('text', intakeText.trim());
    intakeFiles.forEach(file => form.append('files', file, file.name));
    try {
      const workspace = await api<Workspace>(user, '/intake/extract', { method: 'POST', body: form });
      setData(workspace); setIntakeFiles([]); setIntakeText('');
    } catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }

  function updateCandidate(draftId: string, changes: Partial<IntakeCandidate>) {
    setData(current => current?.intakeDraft ? {
      ...current,
      intakeDraft: { ...current.intakeDraft, candidates: current.intakeDraft.candidates.map(row => row.draftId === draftId ? { ...row, ...changes } : row) },
    } : current);
  }

  async function commitIntake() {
    if (!data?.intakeDraft) return;
    const rows = data.intakeDraft.candidates.filter(row => selectedDrafts.has(row.draftId));
    setBusy('intake-commit'); setError('');
    try {
      setData(await api<Workspace>(user, '/intake/commit', json({ draftId: data.intakeDraft.id, rows, version: data.version })));
    } catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }

  async function discardIntake() {
    if (!data?.intakeDraft) return;
    setBusy('intake-discard'); setError('');
    try { setData(await api<Workspace>(user, '/intake/discard', json({ draftId: data.intakeDraft.id, version: data.version }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }

  async function importFile(kind: 'invoices' | 'bank', file?: File) {
    if (!file || !data) return;
    setBusy(kind); setError('');
    try { setData(await api<Workspace>(user, `/import/${kind}`, json({ csv: await file.text(), version: data.version }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function approve(p: Match) {
    if (!data) return;
    setBusy(p.invoiceId); setError('');
    try { setData(await api<Workspace>(user, '/approvals', json({ invoiceId: p.invoiceId, bankId: p.bankId, version: data.version }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function investigate(id: string) {
    if (!data) return;
    setBusy(id); setError('');
    try {
      const result = await api<{ workspace: Workspace }>(user, '/investigate', json({ invoiceId: id, version: data.version }));
      setData(result.workspace);
    } catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function reviewBrief(id: string, brief: Brief) {
    if (!data) return;
    setBusy(`review-${id}`); setError('');
    try { setData(await api<Workspace>(user, '/brief-reviews', json({ invoiceId: id, sourceFingerprint: brief.sourceFingerprint, version: data.version }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function downloadPack(format: 'pdf' | 'xlsx') {
    setBusy(`export-${format}`); setError('');
    try {
      await downloadApiFile(user, `/handover.${format}`, `naijaledger-review-pack.${format}`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }
  const row = (id: string, items: Row[]) => items.find(x => x.id === id);
  return <main>
    <header><Brand /><div className="account"><span>{user.displayName || user.email || 'Workspace'}</span><button className="quiet" onClick={() => auth && void signOut(auth)}>Sign out</button></div></header>
    <section className="hero"><div><p className="eyebrow">SALES → BANK → EVIDENCE</p><h1>Know what settled.<br /><span>Know what needs review.</span></h1><p>Import source records, approve exact matches, and use Meta AI to investigate what remains. Your workspace saves as you go.</p></div><div className="hero-note"><strong>Review first</strong><p>Amounts and dates create proposals. Fees, deductions, owner funds and loans remain unresolved until you review supporting evidence.</p><small>Private Firebase workspace</small></div></section>
    {error && <div role="alert" className="error">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {!data && !error && <p role="status" className="loading">Loading your workspace…</p>}
    {data && <>
      <section className="stats"><article><small>Invoices</small><b>{money(data.totals.invoicedKobo)}</b><span>{data.invoices.length} sales records</span></article><article><small>Bank credits</small><b>{money(data.totals.bankCreditsKobo)}</b><span>Includes funds needing classification</span></article><article><small>Approved matches</small><b>{money(data.totals.approvedKobo)}</b><span>{data.matches.length} reviewed allocations</span></article><article><small>Needs investigation</small><b>{data.unresolvedInvoices.length}</b><span>Invoices without a simple match</span></article></section>
      <section className="card smart-intake">
        <div className="sectionhead"><div><p className="eyebrow">01 · META SMART INTAKE</p><h2>Turn messy records into reviewable invoices</h2><p>Upload several sources at once, dictate a sale, or type it naturally. Nothing enters the ledger until you confirm it.</p></div><span className="pill">Human-controlled import</span></div>
        <div className="intake-compose">
          <div className="intake-upload">
            <label className="drop smart-drop"><strong>Documents, scans and voice notes</strong><span>Handwritten daybooks, invoice images, PDF, DOCX, XLSX, TXT, WAV, MP3, M4A, OGG or WEBM</span><input aria-label="Upload sales source documents" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.txt,.wav,.mp3,.m4a,.ogg,.webm,.aac,image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,audio/*" disabled={!!busy} onChange={event => { if (event.target.files) addIntakeFiles(event.target.files); event.target.value = ''; }} /><em>Choose up to 8 source files</em><small>15 MB each · 40 MB combined · originals are not stored</small></label>
            <button type="button" className={`voice-button ${recording ? 'recording' : ''}`} disabled={!!busy} onClick={() => void toggleRecording()}><span>{recording ? '■' : '●'}</span>{recording ? 'Stop and attach voice entry' : 'Record a voice entry'}</button>
            {intakeFiles.length > 0 && <div className="file-chips" aria-label="Selected source files">{intakeFiles.map((file, index) => <span key={`${file.name}-${file.lastModified}-${index}`}><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small><button aria-label={`Remove ${file.name}`} disabled={!!busy} onClick={() => setIntakeFiles(current => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div>}
          </div>
          <div className="typed-entry"><label htmlFor="typed-sales-entry"><strong>Type or paste a sales entry</strong><span>Example: “29 Oct 2026 — sold 20 bags to Bola Foods for ₦80,000, invoice INV-002.”</span></label><textarea id="typed-sales-entry" value={intakeText} disabled={!!busy} maxLength={20000} onChange={event => setIntakeText(event.target.value)} placeholder="Paste notes, copied messages, or several sales entries here…"/><small>{intakeText.length.toLocaleString()} / 20,000 characters</small></div>
        </div>
        <div className="intake-run"><p><strong>Meta processing:</strong> Muse Spark reads documents and structures entries. Voice notes are transcribed with Muse Voice first. Source hashes and confidence stay attached to every candidate.</p><button disabled={!!busy || (!intakeFiles.length && !intakeText.trim())} onClick={() => void analyzeIntake()}>{busy === 'intake-analyze' ? `Reading ${intakeFiles.length + (intakeText.trim() ? 1 : 0)} source${intakeFiles.length + (intakeText.trim() ? 1 : 0) === 1 ? '' : 's'}…` : 'Extract invoice candidates'}</button></div>
        {data.intakeDraft && <section className="intake-review" aria-label="Extracted invoice review queue">
          <div className="review-banner"><div><small>REVIEW QUEUE · {new Date(data.intakeDraft.createdAt).toLocaleString('en-NG')}</small><h3>{data.intakeDraft.candidates.length} invoice candidate{data.intakeDraft.candidates.length === 1 ? '' : 's'} from {data.intakeDraft.sources.length} source{data.intakeDraft.sources.length === 1 ? '' : 's'}</h3><p>Correct uncertain fields, untick anything that is not a sale, then add only the reviewed rows.</p></div><span>{selectedDrafts.size} selected</span></div>
          <div className="source-strip">{data.intakeDraft.sources.map(source => <article className={source.status} key={source.id}><div><b>{source.status === 'extracted' ? '✓' : '!'} {source.name}</b><small>{source.type} · {source.sha256.slice(0, 10)}…</small></div><span>{source.status === 'extracted' ? `${source.entryCount} found` : 'Could not read'}</span>{source.status === 'failed' && <p>{source.error}</p>}{source.summary && <p>{source.summary}</p>}</article>)}</div>
          {data.intakeDraft.candidates.length > 0 ? <div className="draft-table"><table><thead><tr><th>Use</th><th>Invoice ID</th><th>Date</th><th>Customer</th><th>Amount (NGN)</th><th>Source confidence</th></tr></thead><tbody>{data.intakeDraft.candidates.map(candidate => <tr key={candidate.draftId}><td><input aria-label={`Select ${candidate.invoiceId}`} type="checkbox" checked={selectedDrafts.has(candidate.draftId)} onChange={event => setSelectedDrafts(current => { const next = new Set(current); if (event.target.checked) next.add(candidate.draftId); else next.delete(candidate.draftId); return next; })}/></td><td><input aria-label="Invoice ID" value={candidate.invoiceId} onChange={event => updateCandidate(candidate.draftId, { invoiceId: event.target.value })}/></td><td><input aria-label="Invoice date" type="date" value={candidate.date} onChange={event => updateCandidate(candidate.draftId, { date: event.target.value })}/></td><td><input aria-label="Customer" value={candidate.customer} onChange={event => updateCandidate(candidate.draftId, { customer: event.target.value })}/></td><td><input aria-label="Amount in naira" type="number" min="0.01" step="0.01" value={candidate.amountKobo ? candidate.amountKobo / 100 : ''} onChange={event => updateCandidate(candidate.draftId, { amountKobo: Math.round(Number(event.target.value) * 100) || 0 })}/></td><td><span className={`confidence ${candidate.confidence}`}>{candidate.confidence}</span><small>{candidate.sourceLabel}{candidate.sourceLocator ? ` · ${candidate.sourceLocator}` : ''}</small>{candidate.warnings.length > 0 && <em>{candidate.warnings.join(' ')}</em>}</td></tr>)}</tbody></table></div> : <p className="empty">No invoice rows were found. Check the source status, then try a clearer scan or add a typed entry.</p>}
          <div className="review-actions"><p>Committing rows changes the invoice ledger and clears older AI briefs so every later conclusion stays bound to current evidence.</p><button className="quiet" disabled={!!busy} onClick={() => void discardIntake()}>{busy === 'intake-discard' ? 'Discarding…' : 'Discard draft'}</button><button disabled={!!busy || !selectedDrafts.size} onClick={() => void commitIntake()}>{busy === 'intake-commit' ? 'Adding reviewed invoices…' : `Add ${selectedDrafts.size} reviewed invoice${selectedDrafts.size === 1 ? '' : 's'}`}</button></div>
          <small className="draft-fingerprint">Draft fingerprint: {data.intakeDraft.sourceFingerprint.slice(0, 20)}… · AI extraction is never an approval.</small>
        </section>}
      </section>
      <section className="card imports csv-lane"><div className="sectionhead"><div><p className="eyebrow">01B · CSV FAST LANE</p><h2>Import structured records</h2><p>Use CSV when your sales system or bank already exports clean rows.</p></div><span className="pill">Saved workspace</span></div><div className="filegrid">{(['invoices', 'bank'] as const).map(kind => <label className="drop" key={kind}><strong>{kind === 'invoices' ? 'Sales invoices' : 'Bank transactions'}</strong><span>{kind === 'invoices' ? 'id, date, customer, amount' : 'id, date, description, amount'}</span><input aria-label={`Upload ${kind} CSV`} type="file" accept=".csv,text/csv" disabled={!!busy} onChange={e => { void importFile(kind, e.target.files?.[0]); e.target.value = ''; }} /><em>{busy === kind ? 'Importing…' : 'Choose CSV file'}</em><small>{data[kind].length} rows · Source SHA-256 {data.imports[kind]?.slice(0, 12)}…</small></label>)}</div><p className="fine">Importing either file resets approvals and AI briefs so decisions never silently carry over to new records.</p></section>
      <section className="card"><div className="sectionhead"><div><p className="eyebrow">02 · RECONCILIATION DESK</p><h2>Suggested matches</h2><p>Exact amount and date are suggestions. Check source rows before approving.</p></div><span className="pill">{data.proposals.length} to review</span></div><div className="list">{data.proposals.map(p => <div className="pair" key={p.invoiceId}><div><b>{p.invoiceId} <span>↔</span> {p.bankId}</b><p>{row(p.invoiceId, data.invoices)?.customer} · Invoice row {row(p.invoiceId, data.invoices)?.sourceRow} · Bank row {row(p.bankId, data.bank)?.sourceRow}</p><small>{p.reason}</small></div><div className="pair-action"><strong>{money(p.amountKobo)}</strong><button disabled={!!busy} onClick={() => void approve(p)}>{busy === p.invoiceId ? 'Saving…' : 'Approve match'}</button></div></div>)}{data.proposals.length === 0 && <p className="empty">No exact match proposals to review.</p>}</div></section>
      <section className="card"><div className="sectionhead"><div><p className="eyebrow">03 · META EVIDENCE LAB</p><h2>Unresolved invoices</h2><p>Explore possible explanations with cited records, independent verification, and a human checkpoint.</p></div></div><div className="list">{data.unresolvedInvoices.map(inv => <div className="unresolved" key={inv.id}><div className="unresolved-head"><div><b>{inv.id} · {inv.customer}</b><p>{inv.date} · Source row {inv.sourceRow}</p></div><strong>{money(inv.amountKobo)}</strong><button disabled={!!busy} onClick={() => void investigate(inv.id)}>{busy === inv.id ? 'Investigating + verifying…' : data.briefs[inv.id] ? 'Regenerate brief' : 'Investigate with Meta'}</button></div><p className="consent-note">This sends this invoice and up to 12 relevant bank credit rows to Meta Model API. A second independent Muse pass checks the resulting claims.</p>{data.briefs[inv.id] && <EvidenceBrief brief={data.briefs[inv.id]} bank={data.bank} onReview={() => void reviewBrief(inv.id, data.briefs[inv.id])} reviewing={busy === `review-${inv.id}`} />}</div>)}{data.unresolvedInvoices.length === 0 && <p className="empty">No unresolved invoices.</p>}</div></section>
      <section className="card"><div className="sectionhead"><div><p className="eyebrow">04 · BANK REVIEW</p><h2>Unresolved bank entries</h2><p>Review fees, other income, capital, loans and unmatched customer payments.</p></div></div><div className="tablewrap"><table><thead><tr><th>Source</th><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>{data.unresolvedBank.map(b => <tr key={b.id}><td>{b.id} <small>row {b.sourceRow}</small></td><td>{b.date}</td><td>{b.description}</td><td>{money(b.amountKobo)}</td></tr>)}</tbody></table></div></section>
      <section className="card handover"><div className="sectionhead"><div><p className="eyebrow">05 · REVIEW TRAIL</p><h2>A clear handover</h2><p>Download a visual PDF summary or a complete Excel workbook with source hashes, decisions, verification receipts, unresolved items, AI briefs, and audit activity.</p></div><div className="export-actions"><button className="quiet export-pdf" disabled={!!busy} onClick={() => void downloadPack('pdf')}>{busy === 'export-pdf' ? 'Preparing PDF…' : 'Download PDF'}</button><button disabled={!!busy} onClick={() => void downloadPack('xlsx')}>{busy === 'export-xlsx' ? 'Preparing Excel…' : 'Download Excel'}</button></div></div><div className="activity">{data.audit.slice(-5).reverse().map((event, index) => <div key={`${event.at}-${index}`}><span className="activity-dot"/><strong>{activityText(event)}</strong><time>{new Date(event.at).toLocaleString('en-NG')}</time></div>)}{data.audit.length === 0 && <p className="empty">Your review activity will appear here.</p>}</div></section>
    </>}
    <footer>NaijaLedger beta · Human approval required · No tax filing</footer>
  </main>;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!auth);
  useEffect(() => auth ? onAuthStateChanged(auth, current => { setUser(current); setReady(true); }) : undefined, []);
  if (!ready) return <main><header><Brand /></header><p className="loading">Checking your session…</p></main>;
  return user ? <Desk key={user.uid} user={user} /> : <Welcome />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

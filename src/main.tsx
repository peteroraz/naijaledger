import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleAuthProvider, onAuthStateChanged, signInAnonymously, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, firebaseReady } from './firebase';
import './style.css';

type Row = { id: string; date: string; amountKobo: number; sourceRow: number; customer?: string; description?: string };
type Match = { invoiceId: string; bankId: string; amountKobo: number; reason?: string };
type CashProposal = { cashEntryIds: string[]; bankId: string; amountKobo: number; entryCount: number; frequency: 'daily' | 'weekly'; startDate: string; endDate: string; reason: string };
type StockItem = { sku: string; item: string; unit: string; openingQty: number; receivedQty: number; soldQty: number; adjustmentQty: number; countedQty: number; expectedQty?: number; varianceQty?: number; status?: 'balanced' | 'shortage' | 'surplus' };
type Reviewer = { uid: string; displayName: string; email?: string | null; isAnonymous?: boolean };
type ManualResolution = { id: string; kind: 'invoice' | 'bank' | 'cash' | 'stock'; recordId: string; amountKobo: number; varianceQty?: number | null; comment: string; reviewedAt: string; reviewer: Reviewer; metaInvestigated?: boolean; sourceHash?: string | null };
type RejectedProposal = { id: string; kind: 'invoice' | 'cash'; invoiceId?: string | null; bankId: string; cashEntryIds: string[]; amountKobo: number; comment: string; rejectedAt: string; reviewer: Reviewer };
type AuditEvent = { action: string; kind?: string; rows?: number; sources?: number; invoiceId?: string; bankId?: string; recordId?: string; comment?: string; by?: string; actor?: Reviewer; at: string };
type ReviewHistory = { id: string; title: string; startedAt: string; completedAt: string; completedBy?: Reviewer; counts: { invoices: number; bank: number; cashbook: number; stock: number }; totals: { invoicedKobo: number; bankCreditsKobo: number; approvedInvoiceKobo: number; cashSalesKobo: number; bankedCashKobo: number; manualReviewedInvoiceKobo?: number; manualReviewedBankKobo?: number; reconciledKobo?: number }; results: { approvedInvoiceMatches: number; approvedCashDeposits: number; manualResolutions?: number; stockVarianceItems: number }; manualResolutions?: ManualResolution[]; audit?: AuditEvent[] };
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
type AgentAnswer = {
  question: string; finding: string; calculation: string; confidence: 'low' | 'medium'; missingEvidence: string[];
  nextCheck: string; decisionBoundary: string; model: string; createdAt: string; sourceFingerprint: string;
  evidence: { sourceId: string; statement: string; type: string; title: string; locator: string; sourceHash: string }[];
  retrieval: {
    mode: 'structured-evidence'; chunksConsidered: number; selectedCount: number;
    evidence: { id: string; type: string; title: string; label: string; locator: string; verificationStatus: string; retrievalReason: string; retrievalScore?: number }[];
  };
  verification: {
    status: 'checks_passed' | 'human_review_required'; checkedAt: string;
    checks: { id: string; label: string; passed: boolean; detail: string }[];
    modelReview: { model: string; verdict: 'supported' | 'needs_review' | 'unavailable' | 'skipped'; checkedClaims: number; issues: { claim: string; reason: string; evidenceIds: string[] }[] };
    humanReview: { status: 'pending' | 'reviewed'; reviewedAt?: string; reviewedBy?: string };
  };
};
type IntakeSource = {
  id: string; name: string; type: string; mimeType: string; sha256: string; size: number;
  status: 'extracted' | 'failed'; summary?: string; preview?: string; entryCount: number; error?: string; pipeline?: string;
};
type IntakeCandidate = {
  draftId: string; invoiceId: string; recordType: 'invoice' | 'cash_sale'; date: string; customer: string; amountKobo: number; description: string;
  confidence: 'high' | 'medium' | 'low'; sourceId: string; sourceLabel: string; sourceType: string;
  sourceHash: string; sourceLocator: string; warnings: string[]; extractionModel: string;
};
type IntakeDraft = {
  id: string; createdAt: string; model: string; voiceModel: string; sourceFingerprint: string;
  sources: IntakeSource[]; candidates: IntakeCandidate[]; status: 'awaiting_human_review';
};
type Workspace = {
  invoices: Row[]; bank: Row[]; proposals: Match[]; matches: Match[]; unresolvedInvoices: Row[]; unresolvedBank: Row[];
  cashbook: Row[]; cashAllocations: { cashEntryIds: string[]; bankId: string; reviewedAt: string; reviewedBy: string }[];
  cashReview: { matches: CashProposal[]; proposals: CashProposal[]; unbankedCash: Row[]; totals: { cashSalesKobo: number; bankedCashKobo: number; proposedCashKobo: number } };
  stockReview: { items: StockItem[]; summary: { totalItems: number; balancedItems: number; varianceItems: number } };
  unresolvedStock: StockItem[]; rejectedProposals: RejectedProposal[];
  reviewCycle: { title: string; startedAt: string }; reviewHistory: ReviewHistory[];
  totals: { invoicedKobo: number; bankCreditsKobo: number; approvedKobo: number; manualReviewedInvoiceKobo: number; manualReviewedBankKobo: number; manualReviewedCashKobo: number; manualReviewedKobo: number; reconciledKobo: number; ledgerReviewedKobo: number };
  manualResolutions: ManualResolution[];
  closeBlockers: { invoiceProposals: number; cashProposals: number; unresolvedInvoices: number; unresolvedBank: number; unbankedCash: number; stockVariances: number; pendingDraft: number; pendingBriefs: number; pendingAgentAnswers: number; total: number };
  version: number; imports: Record<string, string>; briefs: Record<string, Brief>; agentAnswers: AgentAnswer[]; intakeDraft: IntakeDraft | null; updatedAt: string;
  audit: AuditEvent[];
  demo: { isDemo: boolean; limits: { intake: number | null; investigate: number; agent: number }; usage: { intake: number; investigate: number; agent: number } };
};
type WorkspaceView = 'overview' | 'import' | 'reconcile' | 'evidence' | 'stock' | 'review';
const workspaceViews: { id: WorkspaceView; label: string; shortLabel: string }[] = [
  { id: 'overview', label: 'Overview', shortLabel: 'Overview' },
  { id: 'import', label: 'Import records', shortLabel: 'Import' },
  { id: 'reconcile', label: 'Reconcile', shortLabel: 'Reconcile' },
  { id: 'evidence', label: 'AI Evidence', shortLabel: 'AI Evidence' },
  { id: 'stock', label: 'Stock', shortLabel: 'Stock' },
  { id: 'review', label: 'Review & Export', shortLabel: 'Review' },
];
const isWorkspaceView = (value: string | null): value is WorkspaceView => workspaceViews.some(view => view.id === value);
const money = (n: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(n / 100);
const reviewerLabel = (reviewer?: Reviewer) => reviewer?.displayName || reviewer?.email || reviewer?.uid || 'Reviewer';
const authMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('popup-closed-by-user')) return 'The sign-in window was closed before authentication finished.';
  if (message.includes('popup-blocked')) return 'Your browser blocked the sign-in window. Allow pop-ups for this site and retry.';
  if (message.includes('network-request-failed')) return 'The sign-in service could not be reached. Check your connection and retry.';
  if (message.includes('api-key-not-valid')) return 'Firebase sign-in is not configured for this deployment.';
  if (message.includes('operation-not-allowed')) return 'This sign-in method is not enabled in Firebase.';
  return 'Sign-in could not be completed. Please retry.';
};
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
  if (event.action === 'source-replaced') return `Replaced the active ${event.kind} source`;
  if (event.action === 'source-cleared') return `Cleared the active ${event.kind} source`;
  if (event.action === 'intake-extracted') return `Meta extracted ${event.rows} candidates from ${event.sources} sources`;
  if (event.action === 'intake-committed') return `Added ${event.rows} human-reviewed sales records`;
  if (event.action === 'intake-discarded') return 'Discarded a document extraction draft';
  if (event.action === 'demo-reset') return 'Reset the Judge Demo sample workspace';
  if (event.action === 'approved') return `Approved ${event.invoiceId} ↔ ${event.bankId}`;
  if (event.action === 'cash-deposit-approved') return `Approved cash lodgement → ${event.bankId}`;
  if (event.action === 'proposal-rejected') return `Rejected a ${event.kind} proposal`;
  if (event.action === 'proposal-reopened') return `Reopened a ${event.kind} proposal`;
  if (event.action === 'decision-reopened') return 'Reopened a reviewed decision';
  if (event.action === 'stock-count-saved') return `Saved ${event.rows} stock-count items`;
  if (event.action === 'review-cycle-started') return 'Archived the completed review and started a clean cycle';
  if (event.action === 'exception-resolved') return `Resolved ${event.kind} ${event.recordId || event.invoiceId || event.bankId} with a review comment`;
  if (event.action === 'brief-reviewed') return `Human reviewed ${event.invoiceId} evidence brief`;
  if (event.action === 'rag-asked') return 'Asked the NaijaLedger Evidence Agent';
  if (event.action === 'rag-reviewed') return 'Human reviewed an Evidence Agent answer';
  return `Investigated and verified ${event.invoiceId}`;
}

function Brand() {
  return <div className="brand"><div className="icon">₦</div><div><b>NaijaLedger</b><small>Clarity for every naira</small></div></div>;
}

function Welcome() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  async function login() {
    if (!auth) return;
    setError(''); setBusy('google');
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { setError(authMessage(e)); }
    finally { setBusy(''); }
  }
  async function enterDemo() {
    if (!auth) return;
    setError(''); setBusy('demo');
    try { await signInAnonymously(auth); }
    catch (e) {
      const message = e instanceof Error ? e.message : '';
      setError(message.includes('operation-not-allowed') ? 'Judge Demo is awaiting Anonymous sign-in activation in Firebase.' : authMessage(e));
    } finally { setBusy(''); }
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
        <h2>Open your private review workspace.</h2>
        <p>Google sign-in opens a clean workspace for your own records. Judge Demo loads a separate synthetic business with live Meta features.</p>
        {firebaseReady ? <><button className="primary-large" disabled={!!busy} onClick={() => void login()}>{busy === 'google' ? 'Opening Google…' : 'Continue with Google'} <span>→</span></button><div className="login-divider"><span>or</span></div><button className="judge-entry" disabled={!!busy} onClick={() => void enterDemo()}><span className="judge-spark">✦</span><span><b>{busy === 'demo' ? 'Preparing Judge Demo…' : 'Enter Judge Demo'}</b><small>No account · synthetic records · live Meta models</small></span><i>→</i></button></>
          : <div className="setup-note" role="status">Firebase is not configured yet. Add the web app values in <code>.env.local</code>, then restart Vite. See README setup.</div>}
        {error && <div className="error" role="alert">{error}</div>}
        <small>Normal workspaces stay private. Judge Demo is isolated and uses synthetic records with bounded model calls.</small>
      </section>
    </div>
    <footer>NaijaLedger · A human reviews every allocation</footer>
  </main>;
}

function EvidenceBrief({ brief, bank, invoices, onReview, reviewing }: { brief: Brief; bank: Row[]; invoices: Row[]; onReview: () => void; reviewing: boolean }) {
  const cited = (id: string) => [...invoices, ...bank].find(row => row.id === id);
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

function EvidenceAgentAnswer({ answer, onReview, reviewing }: { answer: AgentAnswer; onReview: () => void; reviewing: boolean }) {
  const citation = (id: string) => answer.evidence.find(item => item.sourceId === id);
  return <section className="rag-result" aria-label="NaijaLedger Evidence Agent answer">
    <div className="rag-retrieval-head"><div><small>RETRIEVED BEFORE GENERATION</small><strong>{answer.retrieval.selectedCount} of {answer.retrieval.chunksConsidered} evidence chunks selected</strong><p>Accounting-aware structured retrieval · source IDs, amounts, dates, customers and review policy</p></div><span className="vector-live">Evidence retrieval</span></div>
    <div className="rag-source-grid">{answer.retrieval.evidence.map(source => <article key={source.id}><div><span>{source.type.replaceAll('_', ' ')}</span><em>{source.verificationStatus.replaceAll('_', ' ')}</em></div><strong>{source.title}</strong><p>{source.locator}</p><small>{source.retrievalReason || 'supporting evidence'}</small></article>)}</div>
    <div className="rag-answer-body">
      <div className="rag-answer-title"><span className="spark">✦</span><div><small>MUSE SPARK · GROUNDED ANSWER</small><strong>{answer.question}</strong></div><span className="model-badge">{answer.model}</span></div>
      <p className="rag-finding">{answer.finding}</p>
      <div className="rag-citations">{answer.evidence.map(item => <article key={`${item.sourceId}-${item.statement}`}><span>{item.sourceId}</span><p>{item.statement}</p><small>{item.title} · {item.locator}</small></article>)}</div>
      {answer.calculation && <div className="rag-calculation"><small>CALCULATION</small><p>{answer.calculation}</p></div>}
      <div className="rag-actions-grid"><div><small>CONFIDENCE</small><strong>{answer.confidence}</strong><p>Constrained to low or medium until a person checks the evidence.</p></div><div><small>NEXT CHECK</small><strong>{answer.nextCheck}</strong></div></div>
      {answer.missingEvidence.length > 0 && <div className="missing"><strong>Evidence still needed</strong><ul>{answer.missingEvidence.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      <section className={`receipt ${answer.verification.status}`}><div className="receipt-head"><div><small>RAG VERIFICATION RECEIPT</small><strong>{answer.verification.status === 'checks_passed' ? 'Retrieval and groundedness checks passed' : 'Human attention required'}</strong></div><span>{answer.verification.checks.filter(check => check.passed).length}/{answer.verification.checks.length} deterministic checks</span></div><div className="check-grid">{answer.verification.checks.map(check => <div className={check.passed ? 'check pass' : 'check fail'} key={check.id}><b>{check.passed ? '✓' : '!'}</b><div><strong>{check.label}</strong><p>{check.detail}</p></div></div>)}</div><div className="verifier-row"><div><small>INDEPENDENT MUSE REVIEW</small><strong>{answer.verification.modelReview.verdict === 'supported' ? 'Groundedness supported' : 'Claims need review'}</strong><p>{answer.verification.modelReview.checkedClaims} claims checked</p></div><span className={`verdict ${answer.verification.modelReview.verdict}`}>{answer.verification.modelReview.verdict.replace('_', ' ')}</span></div><div className="human-signoff"><div><small>HUMAN CHECKPOINT</small><strong>{answer.verification.humanReview.status === 'reviewed' ? 'Answer reviewed by a person' : 'Review is still required'}</strong><p>{answer.decisionBoundary}</p></div>{answer.verification.humanReview.status === 'reviewed' ? <span className="reviewed">✓ Reviewed {answer.verification.humanReview.reviewedAt && new Date(answer.verification.humanReview.reviewedAt).toLocaleString('en-NG')}</span> : <button disabled={reviewing} onClick={onReview}>{reviewing ? 'Saving review…' : 'Mark answer reviewed'}</button>}</div></section>
      <small className="provenance">Source fingerprint: {answer.sourceFingerprint.slice(0, 16)}… · {citation(answer.evidence[0]?.sourceId)?.sourceHash?.slice(0, 10) || 'source hashes retained'} · AI cannot approve a match, adjustment, or tax treatment.</small>
    </div>
  </section>;
}

function Desk({ user }: { user: User }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [intakeFiles, setIntakeFiles] = useState<File[]>([]);
  const [intakeText, setIntakeText] = useState('');
  const [recording, setRecording] = useState(false);
  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set());
  const [stockDraft, setStockDraft] = useState<StockItem[]>([]);
  const [cycleTitle, setCycleTitle] = useState('');
  const [resolutionComments, setResolutionComments] = useState<Record<string, string>>({});
  const [agentQuestion, setAgentQuestion] = useState('Why is INV-002 unresolved, and what evidence should I check next?');
  const [activeView, setActiveView] = useState<WorkspaceView>(() => {
    const linked = window.location.hash.replace(/^#/, '');
    if (isWorkspaceView(linked)) return linked;
    const saved = window.sessionStorage.getItem('naijaledger-workspace-view');
    return isWorkspaceView(saved) ? saved : 'overview';
  });
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream } | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const refresh = () => api<Workspace>(user, '/workspace').then(workspace => { setData(workspace); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { void refresh(); }, [user.uid]);
  useEffect(() => {
    if (data?.intakeDraft) setSelectedDrafts(new Set(data.intakeDraft.candidates.map(row => row.draftId)));
    else setSelectedDrafts(new Set());
  }, [data?.intakeDraft?.id]);
  useEffect(() => { if (data) setStockDraft(data.stockReview.items.map(({ expectedQty: _expected, varianceQty: _variance, status: _status, ...row }) => row)); }, [data?.version]);
  useEffect(() => { if (data) setCycleTitle(data.reviewCycle.title); }, [data?.reviewCycle.startedAt]);
  useEffect(() => { window.sessionStorage.setItem('naijaledger-workspace-view', activeView); }, [activeView]);
  useEffect(() => {
    const followHash = () => { const linked = window.location.hash.replace(/^#/, ''); if (isWorkspaceView(linked)) setActiveView(linked); };
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);

  function openView(view: WorkspaceView) {
    setActiveView(view);
    window.history.replaceState(null, '', `#${view}`);
    window.requestAnimationFrame(() => document.querySelector('.workspace-navigation')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? workspaceViews.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + workspaceViews.length) % workspaceViews.length;
    const next = workspaceViews[nextIndex].id;
    openView(next); tabRefs.current[next]?.focus();
  }

  function addIntakeFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    if (!selected.length) return;
    const next = [...intakeFiles, ...selected];
    if (next.length > 6) return setError('Choose no more than 6 source files');
    const oversized = selected.find(file => file.size > 10 * 1024 * 1024);
    if (oversized) return setError(`${oversized.name} exceeds the 10 MB per-file limit`);
    if (next.reduce((sum, file) => sum + file.size, 0) > 28 * 1024 * 1024) return setError('Combined source files exceed the 28 MB limit');
    const unsupported = selected.find(file => !/\.(png|jpe?g|webp|pdf|docx|xlsx|txt|wav|mp3|m4a|ogg|webm|aac)$/i.test(file.name));
    if (unsupported) return setError(`${unsupported.name} is not a supported source type`);
    setError('');
    setIntakeFiles(next);
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

  async function importFile(kind: 'invoices' | 'bank' | 'cashbook' | 'stock', file?: File) {
    if (!file || !data) return;
    const existing = kind === 'cashbook' ? data.cashbook.length : kind === 'stock' ? data.stockReview.items.length : data[kind].length;
    let reason = '';
    if (existing) {
      if (!window.confirm(`Replace ${existing} active ${kind} record${existing === 1 ? '' : 's'}? Related decisions and AI answers will be reopened or cleared, and the reason will be retained in the audit trail.`)) return;
      reason = window.prompt('Why are you replacing this active source? This will be saved in the audit trail.')?.trim() || '';
      if (reason.length < 5) return setError('Add an audit reason of at least 5 characters before replacing records.');
    }
    setBusy(kind); setError('');
    try { setData(await api<Workspace>(user, `/import/${kind}`, json({ csv: await file.text(), version: data.version, confirmReplace: existing > 0, reason }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function clearSource(kind: 'invoices' | 'bank' | 'cashbook' | 'stock') {
    if (!data) return;
    const reason = window.prompt(`Why are you clearing the active ${kind} source? This will be saved in the audit trail.`)?.trim() || '';
    if (reason.length < 5) return setError('Add an audit reason of at least 5 characters before clearing records.');
    if (!window.confirm(`Clear the active ${kind} records and affected decisions? Completed review history will not be changed.`)) return;
    setBusy(`clear-${kind}`); setError('');
    try { setData(await api<Workspace>(user, `/sources/${kind}/clear`, json({ comment: reason, version: data.version }))); }
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
  async function approveCash(p: CashProposal) {
    if (!data) return;
    setBusy(`cash-${p.bankId}`); setError('');
    try { setData(await api<Workspace>(user, '/cash-deposits', json({ cashEntryIds: p.cashEntryIds, bankId: p.bankId, version: data.version }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function rejectProposal(kind: 'invoice' | 'cash', proposal: Match | CashProposal) {
    if (!data) return;
    const comment = window.prompt('Why is this proposed match incorrect? The reason will remain in the audit trail.')?.trim() || '';
    if (comment.length < 5) return setError('Add a rejection reason of at least 5 characters.');
    setBusy(`reject-${'invoiceId' in proposal ? proposal.invoiceId : proposal.bankId}`); setError('');
    try {
      const payload = kind === 'invoice'
        ? { kind, invoiceId: (proposal as Match).invoiceId, bankId: proposal.bankId, comment, version: data.version }
        : { kind, cashEntryIds: (proposal as CashProposal).cashEntryIds, bankId: proposal.bankId, comment, version: data.version };
      setData(await api<Workspace>(user, '/proposals/reject', json(payload)));
    } catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function reopenDecision(payload: Record<string, unknown>) {
    if (!data) return;
    const comment = window.prompt('Why are you reopening this decision? The reason will remain in the audit trail.')?.trim() || '';
    if (comment.length < 5) return setError('Add a reopen reason of at least 5 characters.');
    setBusy('decision-reopen'); setError('');
    try { setData(await api<Workspace>(user, '/decisions/reopen', json({ ...payload, comment, version: data.version }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function reopenProposal(rejection: RejectedProposal) {
    if (!data) return;
    const comment = window.prompt('Why should this rejected proposal be reconsidered?')?.trim() || '';
    if (comment.length < 5) return setError('Add a reopen reason of at least 5 characters.');
    setBusy('proposal-reopen'); setError('');
    try { setData(await api<Workspace>(user, '/proposals/reopen', json({ rejectionId: rejection.id, comment, version: data.version }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function saveStock() {
    if (!data) return;
    setBusy('stock-save'); setError('');
    try { setData(await api<Workspace>(user, '/stock', json({ rows: stockDraft, version: data.version }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function resolveException(kind: 'invoice' | 'bank' | 'cash' | 'stock', recordId: string) {
    if (!data) return;
    const key = `${kind}:${recordId}`;
    const comment = (resolutionComments[key] || '').trim();
    if (comment.length < 5) return setError('Add a review comment of at least 5 characters before resolving this record.');
    setBusy(`resolve-${key}`); setError('');
    try {
      setData(await api<Workspace>(user, '/resolutions', json({ kind, recordId, comment, version: data.version })));
      setResolutionComments(current => { const next = { ...current }; delete next[key]; return next; });
    } catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function completeCycle() {
    if (!data || !cycleTitle.trim()) return;
    if (!window.confirm('Archive this review summary and clear the active invoices, bank, cashbook and stock records? This starts a new review cycle.')) return;
    setBusy('cycle-complete'); setError('');
    try { setData(await api<Workspace>(user, '/review-cycles/complete', json({ title: cycleTitle, version: data.version }))); setCycleTitle(''); }
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
  async function askAgent(question = agentQuestion) {
    if (!data || !question.trim()) return;
    setBusy('rag-agent'); setError('');
    try {
      const result = await api<{ answer: AgentAnswer; workspace: Workspace }>(user, '/agent/query', json({ question: question.trim(), version: data.version }));
      setData(result.workspace); setAgentQuestion(question.trim());
    } catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function reviewAgentAnswer(answer: AgentAnswer) {
    if (!data) return;
    setBusy('rag-review'); setError('');
    try { setData(await api<Workspace>(user, '/agent/reviews', json({ sourceFingerprint: answer.sourceFingerprint, createdAt: answer.createdAt, version: data.version }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function reviewBrief(id: string, brief: Brief) {
    if (!data) return;
    setBusy(`review-${id}`); setError('');
    try { setData(await api<Workspace>(user, '/brief-reviews', json({ invoiceId: id, sourceFingerprint: brief.sourceFingerprint, version: data.version }))); }
    catch (e) { setError((e as Error).message); void refresh(); }
    finally { setBusy(''); }
  }
  async function resetDemo() {
    if (!data) return;
    setBusy('demo-reset'); setError('');
    try { setData(await api<Workspace>(user, '/demo/reset', json({ version: data.version }))); }
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
  const viewCounts: Partial<Record<WorkspaceView, number>> = data ? {
    import: data.intakeDraft?.candidates.length || 0,
    reconcile: data.proposals.length + data.cashReview.proposals.length,
    evidence: data.unresolvedInvoices.length,
    stock: data.unresolvedStock.length,
    review: data.closeBlockers.total,
  } : {};
  return <main>
    <header><Brand /><div className="account"><span>{user.isAnonymous ? 'Judge Demo' : user.displayName || user.email || 'Workspace'}</span><button className="quiet" onClick={() => auth && void signOut(auth)}>{user.isAnonymous ? 'Exit demo' : 'Sign out'}</button></div></header>
    {error && <div role="alert" className="error">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {!data && !error && <p role="status" className="loading">Loading your workspace…</p>}
    {data && <>
      <div className="workspace-navigation">
        <nav className="workspace-tabs" aria-label="NaijaLedger workspace" role="tablist">
          {workspaceViews.map((view, index) => <button type="button" role="tab" id={`tab-${view.id}`} aria-selected={activeView === view.id} tabIndex={activeView === view.id ? 0 : -1} ref={element => { tabRefs.current[view.id] = element; }} className={activeView === view.id ? 'active' : ''} key={view.id} onKeyDown={event => moveTab(event, index)} onClick={() => openView(view.id)}><span>{view.label}</span>{viewCounts[view.id] ? <b aria-label={`${viewCounts[view.id]} items`}>{viewCounts[view.id]}</b> : null}</button>)}
        </nav>
        <label className="workspace-select"><span>Workspace area</span><select value={activeView} onChange={event => openView(event.target.value as WorkspaceView)}>{workspaceViews.map(view => <option value={view.id} key={view.id}>{view.shortLabel}{viewCounts[view.id] ? ` (${viewCounts[view.id]})` : ''}</option>)}</select></label>
        <div className="cycle-chip"><span>Active review</span><strong>{data.reviewCycle.title}</strong></div>
      </div>
      {data.demo.isDemo && <section className="demo-banner" aria-label="Judge Demo status">
        <div className="demo-emblem">✦</div>
        <div><small>JUDGE DEMO · ISOLATED SESSION</small><strong>Live Meta models. Synthetic business records.</strong><p>Nothing here belongs to a real business. Human review is still required.</p></div>
        <div className="demo-allowances"><span><b>{data.demo.limits.intake === null ? 'Unlimited' : Math.max(0, data.demo.limits.intake - data.demo.usage.intake)}</b> Smart Intake extractions{data.demo.limits.intake === null ? '' : ' left'}</span><span><b>{Math.max(0, data.demo.limits.investigate - data.demo.usage.investigate)}</b> investigations left</span><span><b>{Math.max(0, data.demo.limits.agent - data.demo.usage.agent)}</b> Evidence Agent questions left</span></div>
        <button className="quiet" disabled={!!busy} onClick={() => void resetDemo()}>{busy === 'demo-reset' ? 'Resetting…' : 'Reset sample'}</button>
      </section>}
      {activeView === 'overview' && <div className="workspace-panel" id="panel-overview" role="tabpanel" aria-label="Overview">
        <section className="hero dashboard-hero"><div><p className="eyebrow">SALES → CASH → BANK → STOCK</p><h1>Know what settled.<br /><span>Know what needs review.</span></h1><p>Bring in invoices, handwritten cashbooks and stock counts; verify bank lodgements; investigate exceptions with Meta AI.</p></div><div className="hero-note"><strong>Review first</strong><p>Amounts and dates create proposals. Every final allocation stays under human control.</p><small>Private Firebase workspace · {data.reviewCycle.title}</small></div></section>
        <section className="stats"><article><small>Invoice sales</small><b>{money(data.totals.invoicedKobo)}</b><span>{data.invoices.length} structured records</span></article><article><small>Cashbook takings</small><b>{money(data.cashReview.totals.cashSalesKobo)}</b><span>{data.cashbook.length} cash entries</span></article><article><small>Ledger reviewed</small><b>{money(data.totals.ledgerReviewedKobo)}</b><span>{money(data.totals.reconciledKobo)} strictly matched · commented exceptions shown separately</span></article><article><small>Stock exceptions</small><b>{data.unresolvedStock.length}</b><span>{data.stockReview.summary.balancedItems}/{data.stockReview.summary.totalItems} items balanced</span></article></section>
        <section className="overview-actions" aria-label="Recommended workflow">
          <button type="button" onClick={() => openView('import')}><span>01</span><div><strong>Bring in records</strong><small>Documents, voice, text or CSV</small></div><i>→</i></button>
          <button type="button" onClick={() => openView('reconcile')}><span>02</span><div><strong>Review matches</strong><small>{data.proposals.length + data.cashReview.proposals.length} proposals need attention</small></div><i>→</i></button>
          <button type="button" onClick={() => openView('evidence')}><span>03</span><div><strong>Ask Meta AI</strong><small>Investigate with cited evidence</small></div><i>→</i></button>
          <button type="button" onClick={() => openView('review')}><span>04</span><div><strong>Export or close</strong><small>PDF, Excel and review history</small></div><i>→</i></button>
        </section>
      </div>}
      {activeView === 'evidence' && <div className="workspace-panel" id="panel-evidence" role="tabpanel" aria-label="AI Evidence">
      <section className="card rag-agent-card">
        <div className="sectionhead"><div><p className="eyebrow">META RAG · NAIJALEDGER EVIDENCE AGENT</p><h2>Ask across sales, cash, bank, stock and review history</h2><p>NaijaLedger retrieves the most relevant records and bookkeeping rules first, then Muse Spark answers only from that cited evidence.</p></div><span className="pill">Retrieval visible to judges</span></div>
        <div className="rag-ask"><textarea aria-label="Question for NaijaLedger Evidence Agent" maxLength={600} value={agentQuestion} disabled={!!busy} onChange={event => setAgentQuestion(event.target.value)} placeholder="Ask why a transaction is unresolved, which cash is not deposited, or what explains a stock variance…"/><button disabled={!!busy || agentQuestion.trim().length < 4 || (data.demo.isDemo && data.demo.usage.agent >= data.demo.limits.agent)} onClick={() => void askAgent()}>{busy === 'rag-agent' ? 'Retrieving + verifying…' : data.demo.isDemo && data.demo.usage.agent >= data.demo.limits.agent ? 'Demo question limit reached' : 'Ask Evidence Agent'}</button></div>
        <div className="rag-prompts">{['Why is INV-002 unresolved, and what evidence should I check next?', 'Which cashbook entries are not yet supported by a bank lodgement?', 'Explain the stock variances and the next human check.', 'What changed in completed review history?'].map(prompt => <button className="quiet" disabled={!!busy} key={prompt} onClick={() => { setAgentQuestion(prompt); void askAgent(prompt); }}>{prompt}</button>)}</div>
        {data.agentAnswers.length > 0 ? <EvidenceAgentAnswer answer={data.agentAnswers.at(-1)!} onReview={() => void reviewAgentAnswer(data.agentAnswers.at(-1)!)} reviewing={busy === 'rag-review'} /> : <div className="rag-empty"><span>✦</span><div><strong>Ready to retrieve</strong><p>The answer will show its retrieved records before the generated finding.</p></div></div>}
      </section>
      <section className="card"><div className="sectionhead"><div><p className="eyebrow">META EVIDENCE LAB</p><h2>Unresolved invoices</h2><p>Investigate with Meta when useful, then close each exception only with a human review comment.</p></div><span className="pill">{data.unresolvedInvoices.length} unresolved</span></div><div className="list">{data.unresolvedInvoices.map(inv => {
        const resolutionKey = `invoice:${inv.id}`;
        return <div className="unresolved" key={inv.id}><div className="unresolved-head"><div><b>{inv.id} · {inv.customer}</b><p>{inv.date} · Source row {inv.sourceRow}</p></div><strong>{money(inv.amountKobo)}</strong><button disabled={!!busy || (data.demo.isDemo && data.demo.usage.investigate >= data.demo.limits.investigate)} onClick={() => void investigate(inv.id)}>{busy === inv.id ? 'Investigating + verifying…' : data.demo.isDemo && data.demo.usage.investigate >= data.demo.limits.investigate ? 'Demo limit reached' : data.briefs[inv.id] ? 'Regenerate brief' : 'Investigate with Meta'}</button></div><p className="consent-note">Meta investigation is optional. If used, this sends the invoice and up to 12 relevant bank credit rows to Meta Model API for a verified evidence brief.</p>{data.briefs[inv.id] && <EvidenceBrief brief={data.briefs[inv.id]} bank={data.bank} invoices={data.invoices} onReview={() => void reviewBrief(inv.id, data.briefs[inv.id])} reviewing={busy === `review-${inv.id}`} />}<div className="resolution-box"><div><small>HUMAN RESOLUTION · COMMENT REQUIRED</small><strong>Mark this invoice reviewed and close the exception</strong><p>This records your explanation in the audit trail and reviewed ledger. It does not create a bank match or tax conclusion.</p></div><textarea aria-label={`Resolution comment for ${inv.id}`} maxLength={1000} value={resolutionComments[resolutionKey] || ''} disabled={!!busy} onChange={event => setResolutionComments(current => ({ ...current, [resolutionKey]: event.target.value }))} placeholder="Explain why this invoice can be closed, the evidence checked, and any follow-up needed…"/><button disabled={!!busy || (resolutionComments[resolutionKey] || '').trim().length < 5} onClick={() => void resolveException('invoice', inv.id)}>{busy === `resolve-${resolutionKey}` ? 'Saving audit trail…' : 'Mark reviewed & resolve'}</button></div></div>;
      })}{data.unresolvedInvoices.length === 0 && <p className="empty">No unresolved invoices. Every invoice exception has an approved match or a commented human resolution.</p>}</div></section>
      </div>}
      {activeView === 'import' && <div className="workspace-panel" id="panel-import" role="tabpanel" aria-label="Import records">
      <section className="card smart-intake">
        <div className="sectionhead"><div><p className="eyebrow">01 · META SMART INTAKE</p><h2>Turn messy records into invoices or cashbook entries</h2><p>Upload handwritten daybooks, scans and documents; dictate a cash sale; or type it naturally. Meta classifies each row, and nothing enters the ledger until you confirm it.</p></div><span className="pill">Human-controlled import</span></div>
        <div className="intake-compose">
          <div className="intake-upload">
            <label className="drop smart-drop"><strong>Documents, scans and voice notes</strong><span>Handwritten daybooks, invoice images, PDF, DOCX, XLSX, TXT, WAV, MP3, M4A, OGG or WEBM</span><input aria-label="Upload sales source documents" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.txt,.wav,.mp3,.m4a,.ogg,.webm,.aac,image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,audio/*" disabled={!!busy} onChange={event => { const selected = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; addIntakeFiles(selected); }} /><em>Choose up to 6 source files</em><small>10 MB each · 28 MB combined · originals are not stored</small></label>
            <button type="button" aria-pressed={recording} aria-label={recording ? 'Stop recording and attach voice entry' : 'Start recording a voice entry'} className={`voice-button ${recording ? 'recording' : ''}`} disabled={!!busy} onClick={() => void toggleRecording()}><span>{recording ? '■' : '●'}</span>{recording ? 'Stop and attach voice entry' : 'Record a voice entry'}</button>
            {intakeFiles.length > 0 && <div className="file-chips" aria-label="Selected source files">{intakeFiles.map((file, index) => <span key={`${file.name}-${file.lastModified}-${index}`}><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small><button aria-label={`Remove ${file.name}`} disabled={!!busy} onClick={() => setIntakeFiles(current => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div>}
          </div>
          <div className="typed-entry"><label htmlFor="typed-sales-entry"><strong>Type or paste sales / cashbook entries</strong><span>Example: “29 Oct — cash sales ₦18,500; cashier deposited the week’s takings on Friday.”</span></label><textarea id="typed-sales-entry" value={intakeText} disabled={!!busy} maxLength={20000} onChange={event => setIntakeText(event.target.value)} placeholder="Paste notes, copied messages, cashbook lines, or several sales entries here…"/><small>{intakeText.length.toLocaleString()} / 20,000 characters</small></div>
        </div>
        <div className="intake-run"><p><strong>Meta processing:</strong> Muse Spark reads and classifies invoices versus cash sales. Voice notes are transcribed with Muse Voice first. Source hashes and confidence stay attached to every candidate.</p><button disabled={!!busy || (!intakeFiles.length && !intakeText.trim()) || (data.demo.isDemo && data.demo.limits.intake !== null && data.demo.usage.intake >= data.demo.limits.intake)} onClick={() => void analyzeIntake()}>{busy === 'intake-analyze' ? `Reading ${intakeFiles.length + (intakeText.trim() ? 1 : 0)} source${intakeFiles.length + (intakeText.trim() ? 1 : 0) === 1 ? '' : 's'}…` : data.demo.isDemo && data.demo.limits.intake !== null && data.demo.usage.intake >= data.demo.limits.intake ? 'Demo extraction limit reached' : 'Extract sales candidates'}</button></div>
        {data.intakeDraft && <section className="intake-review" aria-label="Extracted invoice review queue">
          <div className="review-banner"><div><small>REVIEW QUEUE · {new Date(data.intakeDraft.createdAt).toLocaleString('en-NG')}</small><h3>{data.intakeDraft.candidates.length} sales candidate{data.intakeDraft.candidates.length === 1 ? '' : 's'} from {data.intakeDraft.sources.length} source{data.intakeDraft.sources.length === 1 ? '' : 's'}</h3><p>Confirm whether each is an invoice or cash sale, correct uncertain fields, then add only reviewed rows.</p></div><span>{selectedDrafts.size} selected</span></div>
          <div className="source-strip">{data.intakeDraft.sources.map(source => <article className={source.status} key={source.id}><div><b>{source.status === 'extracted' ? '✓' : '!'} {source.name}</b><small>{source.type} · {source.sha256.slice(0, 10)}…</small></div><span>{source.status === 'extracted' ? `${source.entryCount} found` : 'Could not read'}</span>{source.status === 'failed' && <p>{source.error}</p>}{source.summary && <p>{source.summary}</p>}</article>)}</div>
          {data.intakeDraft.candidates.length > 0 ? <div className="draft-table"><table><thead><tr><th>Use</th><th>Record type</th><th>Record ID</th><th>Date</th><th>Customer</th><th>Amount (NGN)</th><th>Source confidence</th></tr></thead><tbody>{data.intakeDraft.candidates.map(candidate => <tr key={candidate.draftId}><td><input aria-label={`Select ${candidate.invoiceId}`} type="checkbox" checked={selectedDrafts.has(candidate.draftId)} onChange={event => setSelectedDrafts(current => { const next = new Set(current); if (event.target.checked) next.add(candidate.draftId); else next.delete(candidate.draftId); return next; })}/></td><td><select aria-label="Record type" value={candidate.recordType || 'invoice'} onChange={event => updateCandidate(candidate.draftId, { recordType: event.target.value as IntakeCandidate['recordType'] })}><option value="invoice">Invoice</option><option value="cash_sale">Cash sale</option></select></td><td><input aria-label="Record ID" value={candidate.invoiceId} onChange={event => updateCandidate(candidate.draftId, { invoiceId: event.target.value })}/></td><td><input aria-label="Transaction date" type="date" value={candidate.date} onChange={event => updateCandidate(candidate.draftId, { date: event.target.value })}/></td><td><input aria-label="Customer" value={candidate.customer} onChange={event => updateCandidate(candidate.draftId, { customer: event.target.value })}/></td><td><input aria-label="Amount in naira" type="number" min="0.01" step="0.01" value={candidate.amountKobo ? candidate.amountKobo / 100 : ''} onChange={event => updateCandidate(candidate.draftId, { amountKobo: Math.round(Number(event.target.value) * 100) || 0 })}/></td><td><span className={`confidence ${candidate.confidence}`}>{candidate.confidence}</span><small>{candidate.sourceLabel}{candidate.sourceLocator ? ` · ${candidate.sourceLocator}` : ''}</small>{candidate.warnings.length > 0 && <em>{candidate.warnings.join(' ')}</em>}</td></tr>)}</tbody></table></div> : <p className="empty">No supported sales rows were found. Check the source status, then try a clearer scan or add a typed entry.</p>}
          <div className="review-actions"><p>Committing rows updates the correct ledger and clears older AI briefs so conclusions remain bound to current evidence.</p><button className="quiet" disabled={!!busy} onClick={() => void discardIntake()}>{busy === 'intake-discard' ? 'Discarding…' : 'Discard draft'}</button><button disabled={!!busy || !selectedDrafts.size} onClick={() => void commitIntake()}>{busy === 'intake-commit' ? 'Adding reviewed records…' : `Add ${selectedDrafts.size} reviewed record${selectedDrafts.size === 1 ? '' : 's'}`}</button></div>
          <small className="draft-fingerprint">Draft fingerprint: {data.intakeDraft.sourceFingerprint.slice(0, 20)}… · AI extraction is never an approval.</small>
        </section>}
      </section>
      <section className="card imports csv-lane"><div className="sectionhead"><div><p className="eyebrow">01B · CSV FAST LANE</p><h2>Import structured records</h2><p>Replace the active invoices, bank statement, cashbook or stock count with a clean CSV export.</p></div><span className="pill">Versioned workspace</span></div><div className="filegrid four-up">{(['invoices', 'bank', 'cashbook', 'stock'] as const).map(kind => {
        const labels = { invoices: ['Sales invoices', 'id, date, customer, amount'], bank: ['Bank transactions', 'id, date, description, amount'], cashbook: ['Cashbook entries', 'id, date, customer, description, amount'], stock: ['Stock count', 'sku, item, unit + quantity columns'] } as const;
        const count = kind === 'cashbook' ? data.cashbook.length : kind === 'stock' ? data.stockReview.items.length : data[kind].length;
        return <div className="source-drop" key={kind}><label className="drop"><strong>{labels[kind][0]}</strong><span>{labels[kind][1]}</span><input aria-label={`Upload ${kind} CSV`} type="file" accept=".csv,text/csv" disabled={!!busy} onChange={e => { void importFile(kind, e.target.files?.[0]); e.target.value = ''; }} /><em>{busy === kind ? 'Importing…' : count ? 'Replace with CSV' : 'Choose CSV file'}</em><small>{count} rows · SHA-256 {data.imports[kind]?.slice(0, 12) || 'not loaded'}{data.imports[kind] ? '…' : ''}</small></label>{count > 0 && <button type="button" className="clear-source" disabled={!!busy} onClick={() => void clearSource(kind)}>{busy === `clear-${kind}` ? 'Clearing…' : 'Clear active source'}</button>}</div>;
      })}</div><p className="fine">Replacing a source clears any affected allocations. Complete the review cycle first when you want its summary preserved in history.</p></section>
      </div>}
      {activeView === 'reconcile' && <div className="workspace-panel" id="panel-reconcile" role="tabpanel" aria-label="Reconcile">
      <section className="card"><div className="sectionhead"><div><p className="eyebrow">RECONCILIATION DESK</p><h2>Suggested matches</h2><p>Exact amount and date are suggestions. Approve or reject each proposal with a reviewable decision.</p></div><span className="pill">{data.proposals.length} to review</span></div><div className="list">{data.proposals.map(p => <div className="pair" key={p.invoiceId}><div><b>{p.invoiceId} <span>↔</span> {p.bankId}</b><p>{row(p.invoiceId, data.invoices)?.customer} · Invoice row {row(p.invoiceId, data.invoices)?.sourceRow} · Bank row {row(p.bankId, data.bank)?.sourceRow}</p><small>{p.reason}</small></div><div className="pair-action"><strong>{money(p.amountKobo)}</strong><button className="quiet" disabled={!!busy} onClick={() => void rejectProposal('invoice', p)}>Reject</button><button disabled={!!busy} onClick={() => void approve(p)}>{busy === p.invoiceId ? 'Saving…' : 'Approve match'}</button></div></div>)}{data.proposals.length === 0 && <p className="empty">No exact match proposals to review.</p>}</div>
        {data.matches.length > 0 && <details className="decision-register"><summary>{data.matches.length} approved invoice match{data.matches.length === 1 ? '' : 'es'}</summary>{data.matches.map(match => <article key={`${match.invoiceId}-${match.bankId}`}><span>{match.invoiceId} ↔ {match.bankId}</span><b>{money(match.amountKobo)}</b><button className="quiet" disabled={!!busy} onClick={() => void reopenDecision({ type: 'invoice-match', invoiceId: match.invoiceId, bankId: match.bankId })}>Reopen</button></article>)}</details>}
      </section>
      <section className="card cash-desk"><div className="sectionhead"><div><p className="eyebrow">02B · CASH LODGEMENT DESK</p><h2>Balance the cashbook against bank deposits</h2><p>NaijaLedger groups unallocated cash sales by day and week, then finds exact later bank credits. A teller, deposit slip or lodgement reference must still be checked.</p></div><span className="pill">{data.cashReview.proposals.length} deposit{data.cashReview.proposals.length === 1 ? '' : 's'} to review</span></div>
        <div className="cash-metrics"><div><small>Recorded cash sales</small><strong>{money(data.cashReview.totals.cashSalesKobo)}</strong><span>{data.cashbook.length} entries</span></div><div><small>Approved as banked</small><strong>{money(data.cashReview.totals.bankedCashKobo)}</strong><span>{data.cashReview.matches.length} lodgements</span></div><div><small>Exact proposals</small><strong>{money(data.cashReview.totals.proposedCashKobo)}</strong><span>Awaiting human evidence</span></div></div>
        <div className="list">{data.cashReview.proposals.map(proposal => <div className="pair cash-pair" key={proposal.bankId}><div><div className="cash-tag">{proposal.frequency} batch · {proposal.entryCount} cash entries</div><b>{proposal.cashEntryIds.join(' + ')} <span>→</span> {proposal.bankId}</b><p>{proposal.startDate === proposal.endDate ? proposal.startDate : `${proposal.startDate} to ${proposal.endDate}`} · Banked {row(proposal.bankId, data.bank)?.date}</p><small>{proposal.reason}</small></div><div className="pair-action"><strong>{money(proposal.amountKobo)}</strong><button className="quiet" disabled={!!busy} onClick={() => void rejectProposal('cash', proposal)}>Reject</button><button disabled={!!busy} onClick={() => void approveCash(proposal)}>{busy === `cash-${proposal.bankId}` ? 'Saving…' : 'Approve lodgement'}</button></div></div>)}{data.cashReview.proposals.length === 0 && <p className="empty">No exact daily or weekly cash-deposit proposal is waiting for review.</p>}</div>
        {data.cashReview.matches.length > 0 && <details className="decision-register"><summary>{data.cashReview.matches.length} approved cash deposit{data.cashReview.matches.length === 1 ? '' : 's'}</summary>{data.cashReview.matches.map(match => <article key={match.bankId}><span>{match.cashEntryIds.join(' + ')} → {match.bankId}</span><b>{money(match.amountKobo)}</b><button className="quiet" disabled={!!busy} onClick={() => void reopenDecision({ type: 'cash-deposit', bankId: match.bankId })}>Reopen</button></article>)}</details>}
        {data.cashReview.unbankedCash.length > 0 && <details className="cash-unbanked" open><summary>{data.cashReview.unbankedCash.length} cash entries require a deposit match or commented resolution</summary><div className="bank-review-list">{data.cashReview.unbankedCash.map(entry => { const resolutionKey = `cash:${entry.id}`; return <article key={entry.id}><div className="bank-entry-summary"><div><strong>{entry.id}</strong><small>{entry.date} · {entry.customer}</small><p>{entry.description}</p></div><b>{money(entry.amountKobo)}</b></div><div className="bank-resolution"><textarea aria-label={`Resolution comment for cash entry ${entry.id}`} maxLength={1000} value={resolutionComments[resolutionKey] || ''} disabled={!!busy} onChange={event => setResolutionComments(current => ({ ...current, [resolutionKey]: event.target.value }))} placeholder="Describe the cash retained, timing difference, correction or evidence checked…"/><button disabled={!!busy || (resolutionComments[resolutionKey] || '').trim().length < 5} onClick={() => void resolveException('cash', entry.id)}>Mark reviewed & resolve</button></div></article>; })}</div></details>}
        {data.rejectedProposals.length > 0 && <details className="decision-register"><summary>{data.rejectedProposals.length} rejected proposal{data.rejectedProposals.length === 1 ? '' : 's'}</summary>{data.rejectedProposals.map(rejection => <article key={rejection.id}><span>{rejection.invoiceId || rejection.cashEntryIds.join(' + ')} → {rejection.bankId}<small>{rejection.comment}</small></span><b>{money(rejection.amountKobo)}</b><button className="quiet" disabled={!!busy} onClick={() => void reopenProposal(rejection)}>Reconsider</button></article>)}</details>}
      </section>
      </div>}
      {activeView === 'stock' && <div className="workspace-panel" id="panel-stock" role="tabpanel" aria-label="Stock">
      <section className="card stock-card"><div className="sectionhead"><div><p className="eyebrow">STOCK RECONCILIATION</p><h2>A simple count that exposes shrinkage</h2><p>Expected stock = opening + received − sold + adjustments. Enter the physical count; NaijaLedger calculates shortages and surpluses.</p></div><span className={`pill ${data.stockReview.summary.varianceItems ? 'warning-pill' : ''}`}>{data.stockReview.summary.varianceItems} variance{data.stockReview.summary.varianceItems === 1 ? '' : 's'}</span></div>
        <div className="stock-toolbar"><p><strong>{data.stockReview.summary.balancedItems}/{data.stockReview.summary.totalItems}</strong> items currently balance. Quantities may use up to three decimal places.</p><button className="quiet" disabled={!!busy} onClick={() => setStockDraft(current => [...current, { sku: `ITEM-${String(current.length + 1).padStart(3, '0')}`, item: '', unit: 'unit', openingQty: 0, receivedQty: 0, soldQty: 0, adjustmentQty: 0, countedQty: 0 }])}>+ Add item</button><button disabled={!!busy} onClick={() => void saveStock()}>{busy === 'stock-save' ? 'Saving count…' : 'Save stock count'}</button></div>
        <div className="tablewrap stock-table"><table><thead><tr><th>SKU / item</th><th>Opening</th><th>Received</th><th>Sold</th><th>Adjustment</th><th>Expected</th><th>Counted</th><th>Variance</th><th></th></tr></thead><tbody>{stockDraft.map((item, index) => {
          const expected = Number(item.openingQty || 0) + Number(item.receivedQty || 0) - Number(item.soldQty || 0) + Number(item.adjustmentQty || 0); const variance = Number(item.countedQty || 0) - expected;
          const set = (changes: Partial<StockItem>) => setStockDraft(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row));
          return <tr key={`${item.sku}-${index}`} className={Math.abs(variance) < 0.000001 ? 'stock-balanced' : 'stock-variance'}><td><input aria-label="Stock SKU" value={item.sku} onChange={event => set({ sku: event.target.value })}/><input aria-label="Stock item" value={item.item} placeholder="Item name" onChange={event => set({ item: event.target.value })}/><input aria-label="Stock unit" value={item.unit} placeholder="Unit" onChange={event => set({ unit: event.target.value })}/></td>{(['openingQty', 'receivedQty', 'soldQty', 'adjustmentQty'] as const).map(field => <td key={field}><input aria-label={field} type="number" step="0.001" value={item[field]} onChange={event => set({ [field]: Number(event.target.value) })}/></td>)}<td><b>{expected.toLocaleString()}</b></td><td><input aria-label="Counted quantity" type="number" min="0" step="0.001" value={item.countedQty} onChange={event => set({ countedQty: Number(event.target.value) })}/></td><td><span className={variance === 0 ? 'variance-ok' : variance < 0 ? 'variance-short' : 'variance-over'}>{variance > 0 ? '+' : ''}{variance.toLocaleString()}</span></td><td><button className="row-remove" aria-label={`Remove ${item.item || item.sku}`} onClick={() => setStockDraft(current => current.filter((_, rowIndex) => rowIndex !== index))}>×</button></td></tr>;
        })}</tbody></table></div>
        {data.unresolvedStock.length > 0 && <div className="stock-resolution-list"><h3>Stock variances requiring review</h3>{data.unresolvedStock.map(item => { const resolutionKey = `stock:${item.sku}`; return <article key={item.sku}><div><strong>{item.sku} · {item.item}</strong><p>Expected {item.expectedQty?.toLocaleString()} {item.unit}; counted {item.countedQty.toLocaleString()}; variance {(item.varianceQty || 0) > 0 ? '+' : ''}{item.varianceQty?.toLocaleString()}.</p></div><textarea aria-label={`Resolution comment for stock ${item.sku}`} maxLength={1000} value={resolutionComments[resolutionKey] || ''} disabled={!!busy} onChange={event => setResolutionComments(current => ({ ...current, [resolutionKey]: event.target.value }))} placeholder="Explain the count check, damage, shrinkage or approved adjustment…"/><button disabled={!!busy || (resolutionComments[resolutionKey] || '').trim().length < 5} onClick={() => void resolveException('stock', item.sku)}>Mark reviewed & resolve</button></article>; })}</div>}
      </section>
      </div>}
      {activeView === 'review' && <div className="workspace-panel" id="panel-review" role="tabpanel" aria-label="Review and export">
      <section className="card"><div className="sectionhead"><div><p className="eyebrow">BANK REVIEW</p><h2>Unresolved bank entries</h2><p>Review fees, other income, capital, loans and unmatched customer payments. Every closure requires a saved explanation.</p></div><span className="pill">{data.unresolvedBank.length} unresolved</span></div><div className="bank-review-list">{data.unresolvedBank.map(entry => {
        const resolutionKey = `bank:${entry.id}`;
        return <article key={entry.id}><div className="bank-entry-summary"><div><strong>{entry.id}</strong><small>{entry.date} · source row {entry.sourceRow}</small><p>{entry.description}</p></div><b>{money(entry.amountKobo)}</b></div><div className="bank-resolution"><textarea aria-label={`Resolution comment for ${entry.id}`} maxLength={1000} value={resolutionComments[resolutionKey] || ''} disabled={!!busy} onChange={event => setResolutionComments(current => ({ ...current, [resolutionKey]: event.target.value }))} placeholder="Comment on the evidence checked and why this bank entry can be closed…"/><button disabled={!!busy || (resolutionComments[resolutionKey] || '').trim().length < 5} onClick={() => void resolveException('bank', entry.id)}>{busy === `resolve-${resolutionKey}` ? 'Saving…' : 'Mark reviewed & resolve'}</button></div></article>;
      })}{data.unresolvedBank.length === 0 && <p className="empty">No unresolved bank entries. Every bank exception has an allocation or a commented human resolution.</p>}</div></section>
      <section className="card handover"><div className="sectionhead"><div><p className="eyebrow">REVIEW TRAIL</p><h2>Close one period without losing its story</h2><p>Download the current evidence pack, or complete this review to preserve a signed summary before loading the next bank statement and records.</p></div><div className="export-actions"><button className="quiet export-pdf" disabled={!!busy} onClick={() => void downloadPack('pdf')}>{busy === 'export-pdf' ? 'Preparing PDF…' : 'Download PDF'}</button><button disabled={!!busy} onClick={() => void downloadPack('xlsx')}>{busy === 'export-xlsx' ? 'Preparing Excel…' : 'Download Excel'}</button></div></div>
        <div className={`close-readiness ${data.closeBlockers.total ? 'blocked' : 'ready'}`}><strong>{data.closeBlockers.total ? `${data.closeBlockers.total} review item${data.closeBlockers.total === 1 ? '' : 's'} must be closed` : '✓ This period is ready to close'}</strong><span>{data.closeBlockers.unresolvedInvoices} invoice · {data.closeBlockers.unresolvedBank} bank · {data.closeBlockers.invoiceProposals + data.closeBlockers.cashProposals} proposals · {data.closeBlockers.unbankedCash} cash · {data.closeBlockers.stockVariances} stock · {data.closeBlockers.pendingDraft + data.closeBlockers.pendingBriefs + data.closeBlockers.pendingAgentAnswers} evidence checkpoints</span></div>
        <div className="cycle-close"><div><small>ACTIVE REVIEW · STARTED {new Date(data.reviewCycle.startedAt).toLocaleDateString('en-NG')}</small><strong>{data.reviewCycle.title}</strong><p>Completing archives source fingerprints, totals, comments, the signed-in reviewer profile, stock variances and the full period audit trail. Active records are then cleared for the next upload.</p></div><div><input aria-label="Completed review name" maxLength={80} value={cycleTitle} onChange={event => setCycleTitle(event.target.value)} placeholder="e.g. October 2026 review"/><button className="danger-soft" disabled={!!busy || !cycleTitle.trim() || data.closeBlockers.total > 0} onClick={() => void completeCycle()}>{busy === 'cycle-complete' ? 'Archiving…' : data.closeBlockers.total ? 'Resolve all items to close' : 'Complete & start new review'}</button></div></div>
        {data.manualResolutions.length > 0 && <div className="resolution-history"><h3>Commented resolutions in this review</h3>{data.manualResolutions.slice().reverse().map(resolution => <article key={resolution.id}><div><span className="resolution-kind">{resolution.kind}</span><strong>{resolution.recordId}{resolution.kind === 'stock' ? ` · variance ${resolution.varianceQty ?? 0}` : ` · ${money(resolution.amountKobo)}`}</strong><p>{resolution.comment}</p></div><small>{new Date(resolution.reviewedAt).toLocaleString('en-NG')}<br/>{reviewerLabel(resolution.reviewer)}{resolution.reviewer.email ? ` · ${resolution.reviewer.email}` : ''}{resolution.metaInvestigated ? ' · Meta brief used' : ' · Human review without Meta'}<br/><button className="link-button" disabled={!!busy} onClick={() => void reopenDecision({ type: 'resolution', resolutionId: resolution.id })}>Reopen decision</button></small></article>)}</div>}
        {data.reviewHistory.length > 0 && <div className="review-history"><h3>Completed review history</h3><div>{data.reviewHistory.slice().reverse().map(review => <article key={review.id}><small>{new Date(review.completedAt).toLocaleString('en-NG')}{review.completedBy ? ` · ${reviewerLabel(review.completedBy)}` : ''}</small><strong>{review.title}</strong><p>{review.counts.invoices} invoices · {review.counts.cashbook} cash entries · {review.counts.bank} bank rows · {review.counts.stock} stock items</p><div><span>{money(review.totals.reconciledKobo ?? (review.totals.approvedInvoiceKobo + review.totals.bankedCashKobo))} reconciled value</span><span>{review.results.manualResolutions || 0} commented resolutions · {review.results.stockVarianceItems} stock variances</span></div>{Boolean(review.manualResolutions?.length) && <details><summary>View signed resolution trail</summary>{review.manualResolutions!.map(resolution => <section key={resolution.id}><b>{resolution.kind} · {resolution.recordId}</b><p>{resolution.comment}</p><small>{new Date(resolution.reviewedAt).toLocaleString('en-NG')} · {reviewerLabel(resolution.reviewer)}{resolution.reviewer.email ? ` · ${resolution.reviewer.email}` : ''}</small></section>)}</details>}</article>)}</div></div>}
        <div className="activity">{data.audit.slice(-8).reverse().map((event, index) => <div key={`${event.at}-${index}`}><span className="activity-dot"/><section><strong>{activityText(event)}</strong>{event.comment && <p>“{event.comment}”</p>}<small>{event.actor ? `${reviewerLabel(event.actor)}${event.actor.email ? ` · ${event.actor.email}` : ''}` : event.by || 'System'}</small></section><time>{new Date(event.at).toLocaleString('en-NG')}</time></div>)}{data.audit.length === 0 && <p className="empty">Your review activity will appear here.</p>}</div>
      </section>
      </div>}
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


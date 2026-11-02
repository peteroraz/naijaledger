# NaijaLedger

**A source-backed reconciliation copilot for Nigerian SMEs.**

| Submission | Details |
| --- | --- |
| Hackathon | Meta Global AI Developer Hackathon |
| Track | Indie Developer |
| Theme | Build for Your World |
| Builder | Peter Orazulike |
| Live app | [Open NaijaLedger](https://naijaledger-793831462989.europe-west1.run.app/) |
| Source | [github.com/peteroraz/naijaledger](https://github.com/peteroraz/naijaledger) |
| Event build window | 26 October–4 November 2026 |

NaijaLedger is designed for owner-managed Nigerian retailers and bookkeepers whose sales evidence is split across notebooks, voice notes, invoices, spreadsheets and later bank lodgements. It turns those fragments into reviewable records and source-backed reconciliation proposals without allowing AI to approve money movement or tax treatment. A business owner can capture handwritten daybooks, scanned invoices, PDFs, Word files, voice notes, typed entries or CSV exports; review deterministic match suggestions; and investigate missing settlements with Meta models. A human decides every import, allocation and exception closure.

## Meta AI in the product

| Meta model | Real work performed | Human and deterministic controls |
| --- | --- | --- |
| **Muse Spark 1.3** | Extracts schema-constrained sales candidates from handwriting, scans and documents; produces cited Evidence Agent answers; creates unresolved-invoice briefs; performs an independent groundedness review. | Source fingerprints, citation and amount checks, bounded evidence, model receipts and explicit human review prevent automatic posting or settlement. |
| **Muse Voice Transcribe 1.0** | Transcribes uploaded or recorded voice entries before Muse Spark extracts candidate records. | Audio is converted to safe 16 kHz WAV, time-bounded and never stored as raw bytes. A person edits and commits the extracted candidate. |
| **Deterministic application logic** | Retrieves source-addressable evidence, proposes exact unambiguous matches, calculates cash batches and stock variances, and validates model claims. | This is auditable code, not a third-party model. No closed third-party AI service or non-Meta model is called at runtime. |

## Judge Demo — no credentials required

Open the [hosted NaijaLedger app](https://naijaledger-793831462989.europe-west1.run.app/) and choose **Enter Judge Demo**. Do not use or request a shared email or password. The demo creates an isolated anonymous Firebase workspace with synthetic Nigerian SME records while keeping the real Meta model integration active.

Recommended five-minute path:

1. Review the seeded invoices, handwritten-style cashbook entries, bank credits, stock count, and visible demo allowances.
2. In **Meta Smart Intake**, upload the three-file judge pack together: [`samples/01_handwritten_cashbook.png`](samples/01_handwritten_cashbook.png), [`samples/02_sales_note.txt`](samples/02_sales_note.txt), and [`samples/03_voice_note.wav`](samples/03_voice_note.wav). Select **Extract sales candidates**, inspect the live Muse model labels and provenance, correct any uncertain fields, confirm invoice versus cash sale, and commit only the reviewed rows. [`samples/README.txt`](samples/README.txt) explains the expected records.
3. Ask the **NaijaLedger Evidence Agent** why `INV-002` is unresolved. Inspect the records and policy chunks retrieved before Muse Spark's answer, the exact citations, and the independent verification receipt.
4. Approve an invoice match, then open **Cash Lodgement Desk** and approve one exact daily or weekly cash batch only after reading the teller/deposit-slip checkpoint.
5. In **Stock Reconciliation**, change a physical count and observe the live shortage/surplus, then save it. Investigate **INV-002** in **Meta Evidence Lab** and inspect its cited brief.
6. Download the PDF and Excel review packs. In **Review Trail**, complete a named review to archive its summary and open a clean source set; **Reset sample** restores the full Judge Demo without refreshing model allowances.

Each anonymous workspace allows three Smart Intake extractions, five invoice investigations, and three Evidence Agent questions. A separate bounded public traffic limit protects the hosted Meta integration. The banner always labels synthetic data and remaining calls; normal Google workspaces remain private and unchanged. The repository still runs independently using the setup below.

## What works

- Firebase Google sign-in plus anonymous Judge Demo sessions. Every API request verifies a Firebase ID token on the server. Firestore stores an isolated, persistent workspace under the verified user's UID.
- A normal Google sign-in starts with a clean workspace; only the explicitly labelled Judge Demo receives synthetic sample records. Imports, decisions and reversals are atomic Firestore transactions with version checks, so a stale tab receives HTTP 409 instead of overwriting later work.
- Meta Smart Intake accepts up to six mixed sales sources at once: PNG/JPEG/WebP scans, PDF, DOCX, XLSX, TXT, recorded or uploaded audio, and typed natural-language entries. Muse Spark 1.3 extracts schema-constrained invoice or cash-sale candidates from documents, daybooks, handwriting and transcripts. Voice entries are converted to a safe 16 kHz WAV and transcribed with Muse Voice Transcribe before extraction. The original file bytes are never stored.
- Extracted candidates remain in a persistent draft review queue. A person confirms invoice versus cash sale, edits dates, customer names, record IDs and NGN amounts, unticks unsupported rows, and commits only reviewed records. Source type, filename, locator, confidence, SHA-256, model, and audit activity remain attached to every imported row.
- Amounts use integer kobo. Exact-amount credits within 14 days are proposed only when there is no competing invoice. POS deductions, capital, loans, and unknown credits remain unresolved.
- Cash Lodgement Desk groups unallocated cashbook entries by business day and week, and proposes an exact later bank credit only when the grouping is unambiguous. The cashier's teller, lodgement reference or deposit slip remains a mandatory human checkpoint. One bank credit can never be allocated to both an invoice and a cash batch.
- Stock Reconciliation keeps a deliberately simple SKU-level movement record: opening + received - sold + adjustment = expected. A physical count produces a signed shortage/surplus and can be edited directly or replaced from CSV.
- Every proposal can be rejected with a reason, reconsidered, approved and reopened without deleting its history. Invoice, bank, unbanked-cash and stock exceptions can be closed only with a saved human comment; each audit event records UTC date/time and the verified profile. Manually reviewed sales contribute to the separately labelled **ledger-reviewed** figure, never the stricter bank-reconciled figure.
- Completing a review is permitted only when every invoice, bank entry, cash batch, stock variance, intake draft and AI output has a human disposition. It saves a reconstructable immutable snapshot containing full source rows, decisions, rejections, comments, model receipts, hashes and audit events, then clears the active records for the next statement period. Up to twelve completed snapshots remain available.
- The NaijaLedger Evidence Agent creates source-addressable chunks from reviewed invoices, bank rows, cashbook entries, stock records, completed review snapshots and the curated bookkeeping knowledge base. Accounting-aware retrieval ranks exact source IDs, amounts, dates, customers, SKUs and policy terms, then adds plausible bank candidates for a retrieved invoice by name, date and amount gap. It displays this compact evidence set before sending it to Muse Spark 1.3; at most one policy chunk can displace transaction evidence.
- Every Evidence Agent response includes exact citations, visible arithmetic, missing evidence, a next human check, deterministic retrieval/citation/policy and monetary-claim checks, an independent Muse groundedness pass, a SHA-256 evidence fingerprint and a persistent human-read checkpoint.
- “Investigate with Meta” sends one selected invoice and up to 12 bank credits to Muse Spark 1.3. The model returns a constrained evidence brief. A second independent Muse pass reviews groundedness, while deterministic checks verify the schema, source fingerprint, citations, amounts, and decision boundary. The persisted verification receipt records attempts and requires explicit human sign-off. Neither model can approve a match or determine tax treatment.
- The authenticated review pack downloads as a landscape PDF summary and a complete Excel workbook with separate current sources, archived sources, decisions, rejected proposals, verification receipts and audit sheets. Both distinguish strict reconciliation from comment-reviewed ledger value.
- Firestore persistence is gzip-compressed and segmented into bounded chunk documents with a checksum, avoiding the single-document size ceiling while preserving transactional consistency and transparently migrating the earlier layout.

## Run locally

Requires **Node 22+**, a Firebase project, and a Google account. Install with `npm ci`.

1. In Firebase Console, register a Web app and enable **Authentication → Sign-in method → Google**. Also enable **Anonymous** if you want the credential-free Judge Demo path. Add `localhost` to authorized domains if needed. Create a Cloud Firestore database.
2. Copy `.env.example` to `.env.local`. Set the four `VITE_FIREBASE_*` values from the Web app configuration. These are public browser identifiers, not an Admin SDK private key. Set `FIREBASE_PROJECT_ID` to the same project ID.
3. Give the local backend Application Default Credentials: set `GOOGLE_APPLICATION_CREDENTIALS` to the absolute path of a service-account JSON file kept **outside** this repository. In Google Cloud hosting, use workload identity instead. Never paste or commit that JSON. The `firebase-admin` SDK needs access to Authentication and Firestore.
4. Deploy `firestore.rules` to the Firebase project before loading any real records. The browser is denied direct Firestore access; only the server Admin SDK reads and writes data. Keep the server behind HTTPS in production.
5. In separate terminals run `npm run dev` and `npm start`, then open `http://localhost:5173`. Node loads `.env.local` for the server; Vite loads its `VITE_` values for the browser.
6. Optional: set `MODEL_API_KEY` in `.env.local` for Meta features. The key stays on the backend. All runtime AI inference uses Meta models: Muse Spark 1.3 for structured extraction, evidence answers and independent verification, plus Muse Voice Transcribe for audio intake. Evidence retrieval itself is deterministic application logic and does not call another AI model.

Run `npm run check` before submitting. The test suite uses a fake Firestore and Meta response; it does **not** prove that your Firebase or Meta credentials are live. Check those flows manually with your project after setup.

## CSV formats and review rules

Invoices: `id,date,customer,amount`. Bank: `id,date,description,amount`. Cashbook: `id,date,customer,description,amount`. Stock: `sku,item,unit,opening_qty,received_qty,sold_qty,adjustment_qty,counted_qty`. Dates are ISO `YYYY-MM-DD`; amounts are decimal NGN with at most two fractional digits. Limit: 1 MB, 500 data rows, and 160 characters per field. The raw CSV is parsed into workspace rows; its SHA-256 is retained for provenance. Replacing or clearing an active source requires an explicit confirmation and audit reason, invalidates only affected decisions and AI artifacts, and remains visible in the audit trail. Test with the synthetic files in `samples/`.

AI is an investigation aid. Its output is labeled unverified and deliberately constrained to low or medium confidence. Do not use it as a tax filing, accounting certification, or automatic classification.

## Smart Intake formats and safety

Smart Intake supports up to six files, 10 MB per file and 28 MB combined (30 MB request ceiling). Supported sources are `.png`, `.jpg`, `.jpeg`, `.webp`, `.pdf`, `.docx`, `.xlsx`, `.txt`, `.wav`, `.mp3`, `.m4a`, `.ogg`, `.webm`, and `.aac`, plus typed text and an in-browser voice recorder. At most two files are processed concurrently. Audio requires FFmpeg in the runtime; the Docker image installs it and conversion is time-bounded.

Files are processed only after the signed-in user clicks **Extract sales candidates**. Raw bytes are held in memory for that request and are not written to Firestore. Firestore retains the bounded draft, short transcript/text preview when applicable, extracted fields, source fingerprints, and audit history. Document content is treated as untrusted data, so instructions inside a document cannot override the extraction policy. A document extraction never becomes an invoice or cashbook row without the human commit checkpoint.

Judge Demo uses the same verified backend and per-UID Firestore isolation as a normal workspace. Model allowances are consumed in Firestore transactions and survive sample resets. A separate hourly in-memory limit per running Cloud Run instance, keyed by trusted proxy address, bounds public demo model traffic. These controls are for a hackathon demonstration, not a general-purpose public multi-tenant billing system.

## Architecture

`React/Vite → Firebase Authentication → Express (verified ID token) → reviewed evidence chunks → accounting-aware retrieval → Muse Spark answer and verifier → human checkpoint`

The Express server alone calls Meta Model API. Firestore rules deny all browser reads and writes, every workspace is addressed by the verified Firebase UID, and the server checks token revocation as well as signature/expiry. Security headers deny framing and unnecessary browser capabilities. The workspace is stored as checksummed compressed chunks containing normalized source rows, an optional extraction draft, decisions, briefs, Evidence Agent answers, source hashes, version, and a bounded audit log. Smart Intake uses Muse Spark 1.3 for images, PDFs and structured text, `mammoth` for local DOCX text extraction, and Muse Voice Transcribe for speech. The model receives only the small evidence set selected by deterministic retrieval. No closed third-party AI service or non-Meta model is called at runtime.

## Production roadmap beyond the hackathon

- Add partial and split-settlement allocations with explicit fee, withholding and remittance evidence. Current exact matching intentionally leaves ambiguous cases unresolved.
- Add organisation roles, approval thresholds, encrypted raw-evidence retention controls and configurable deletion policies for production teams.
- Move the public demo traffic limiter to a shared store for multi-instance enforcement; the current per-instance limiter is appropriate only for the bounded hackathon demo.
- Expand the synthetic benchmark suite across more Nigerian SME sectors and statement formats while retaining human approval and source-level provenance.

References: [Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Meta structured output](https://dev.meta.ai/docs/cookbook/structured-output), [hackathon details](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details).

## Cloud deployment (Google Cloud Run)

Cloud Run serves the React build and authenticated API from one HTTPS origin. It uses the existing Firestore database in `europe-west1`. Its runtime service account gets `roles/datastore.user` for workspace persistence and `roles/firebaseauth.viewer` so the Admin SDK can verify Firebase users and token revocation; no downloaded Firebase private key is needed. The backend serves public Firebase Web configuration at runtime. The deploy script prompts for the public Web API key; private server credentials are never sent to the browser.

1. Link a Cloud Billing account to `naijaledger-ed044` (Firebase Spark becomes Blaze). Cloud Run has free usage allowances, but this is a metered deployment. Maximum instances is set to two; this is not a spending cap.
2. Open Google Cloud Shell and run:

```bash
git clone https://github.com/peteroraz/naijaledger.git
cd naijaledger
bash deploy-cloud.sh
```

If you already cloned it, run `git pull` in that checkout first. The script enables required APIs, creates the runtime identity if missing, grants database/build access, and deploys from source using the Dockerfile. It requires project owner or equivalent permissions. The runtime uses Application Default Credentials provided by Google.

3. Copy the returned Cloud Run hostname (without `https://`) into Firebase Authentication → Settings → Authorized domains. The Cloud Run page is publicly reachable, while all financial API routes still require a verified Firebase ID token.
4. Test `/api/health`, Google sign-in, one approval, a page reload, then sign out and back in. Confirm the approval remains and that another account has a separate workspace.

For Meta investigations, store `MODEL_API_KEY` in Google Secret Manager and attach it to the Cloud Run service as the `MODEL_API_KEY` environment variable. Grant the runtime identity access to that specific secret. Do not put the value in this script, Dockerfile, Git, or browser configuration. Deploying without the secret leaves reconciliation available and returns a configuration error for investigations.

The production service is hosted at `https://naijaledger-793831462989.europe-west1.run.app/`. Deployment credentials and private keys are not stored in this repository.

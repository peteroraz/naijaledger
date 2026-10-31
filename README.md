# NaijaLedger

**A source-backed reconciliation copilot for Nigerian SMEs.** Built for the Meta Global AI Developer Hackathon's “Build for Your World” theme. A business owner can capture handwritten daybooks, scanned invoices, PDFs, Word files, voice notes, typed entries, or CSV exports; review deterministic match suggestions; and investigate missing settlements with Meta models. A human decides every import and allocation.

## Judge Demo — no credentials required

Open the [hosted NaijaLedger app](https://naijaledger-793831462989.europe-west1.run.app/) and choose **Enter Judge Demo**. Do not use or request a shared email or password. The demo creates an isolated anonymous Firebase workspace with synthetic Nigerian SME records while keeping the real Meta model integration active.

Recommended five-minute path:

1. Review the seeded invoices, handwritten-style cashbook entries, bank credits, stock count, and visible demo allowances.
2. In **Meta Smart Intake**, paste `29 October 2026 — cash sales to walk-in customers were ₦42,500, recorded in the daybook.`, select **Extract sales candidates**, confirm **Cash sale**, inspect the provenance, and commit the reviewed row.
3. Ask the **NaijaLedger Evidence Agent** why `INV-002` is unresolved. Inspect the records and policy chunks retrieved before Muse Spark's answer, the exact citations, and the independent verification receipt.
4. Approve an invoice match, then open **Cash Lodgement Desk** and approve one exact daily or weekly cash batch only after reading the teller/deposit-slip checkpoint.
5. In **Stock Reconciliation**, change a physical count and observe the live shortage/surplus, then save it. Investigate **INV-002** in **Meta Evidence Lab** and inspect its cited brief.
6. Download the PDF and Excel review packs. In **Review Trail**, complete a named review to archive its summary and open a clean source set; **Reset sample** restores the full Judge Demo without refreshing model allowances.

Each anonymous workspace allows three Smart Intake extractions, five invoice investigations, and three Evidence Agent questions. A separate bounded public traffic limit protects the hosted Meta integration. The banner always labels synthetic data and remaining calls; normal Google workspaces remain private and unchanged. The repository still runs independently using the setup below.

## What works

- Firebase Google sign-in plus anonymous Judge Demo sessions. Every API request verifies a Firebase ID token on the server. Firestore stores an isolated, persistent workspace under the verified user's UID.
- First sign-in seeds a synthetic sample business. CSV imports and approvals are atomic Firestore transactions with version checks; a stale tab receives HTTP 409 instead of overwriting a later decision.
- Meta Smart Intake accepts up to eight mixed sales sources at once: PNG/JPEG/WebP scans, PDF, DOCX, XLSX, TXT, recorded or uploaded audio, and typed natural-language entries. Muse Spark 1.3 extracts schema-constrained invoice or cash-sale candidates from documents, daybooks, handwriting and transcripts. Voice entries are converted to a safe 16 kHz WAV and transcribed with Muse Voice Transcribe before extraction. The original file bytes are never stored.
- Extracted candidates remain in a persistent draft review queue. A person confirms invoice versus cash sale, edits dates, customer names, record IDs and NGN amounts, unticks unsupported rows, and commits only reviewed records. Source type, filename, locator, confidence, SHA-256, model, and audit activity remain attached to every imported row.
- Amounts use integer kobo. Exact-amount credits within 14 days are proposed only when there is no competing invoice. POS deductions, capital, loans, and unknown credits remain unresolved.
- Cash Lodgement Desk groups unallocated cashbook entries by business day and week, and proposes an exact later bank credit only when the grouping is unambiguous. The cashier's teller, lodgement reference or deposit slip remains a mandatory human checkpoint. One bank credit can never be allocated to both an invoice and a cash batch.
- Stock Reconciliation keeps a deliberately simple SKU-level movement record: opening + received - sold + adjustment = expected. A physical count produces a signed shortage/surplus and can be edited directly or replaced from CSV.
- Completing a review saves a bounded historical summary with dates, source fingerprints, counts, totals, approved invoice/cash matches and stock exceptions, then clears the active records for the next statement period. Up to twelve completed summaries remain in the workspace.
- The NaijaLedger Evidence Agent creates source-addressable chunks from reviewed invoices, bank rows, cashbook entries, stock records, completed review summaries and the curated bookkeeping knowledge base. It combines accounting-aware retrieval with Firestore vector search, displays the retrieved sources before generation, and sends only the selected evidence to Muse Spark 1.3. If the vector index is still building, a visible structured-retrieval fallback keeps the demo working.
- Every Evidence Agent response includes exact citations, visible arithmetic, missing evidence, a next human check, deterministic retrieval/citation/policy checks, an independent Muse groundedness pass, a SHA-256 evidence fingerprint and a persistent human-read checkpoint.
- “Investigate with Meta” sends one selected invoice and up to 12 bank credits to Muse Spark 1.3. The model returns a constrained evidence brief. A second independent Muse pass reviews groundedness, while deterministic checks verify the schema, source fingerprint, citations, amounts, and decision boundary. The persisted verification receipt records attempts and requires explicit human sign-off. Neither model can approve a match or determine tax treatment.
- The authenticated review pack downloads as a polished PDF summary and a complete Excel workbook. Both retain invoice and cash decisions, cashbook rows, stock variances, review history, source hashes, unresolved rows, verification receipts, AI briefs, and audit activity for accountant review.

## Run locally

Requires **Node 22+**, a Firebase project, and a Google account. Install with `npm ci`.

1. In Firebase Console, register a Web app and enable **Authentication → Sign-in method → Google**. Also enable **Anonymous** if you want the credential-free Judge Demo path. Add `localhost` to authorized domains if needed. Create a Cloud Firestore database.
2. Copy `.env.example` to `.env.local`. Set the four `VITE_FIREBASE_*` values from the Web app configuration. These are public browser identifiers, not an Admin SDK private key. Set `FIREBASE_PROJECT_ID` to the same project ID.
3. Give the local backend Application Default Credentials: set `GOOGLE_APPLICATION_CREDENTIALS` to the absolute path of a service-account JSON file kept **outside** this repository. In Google Cloud hosting, use workload identity instead. Never paste or commit that JSON. The `firebase-admin` SDK needs access to Authentication and Firestore.
4. Deploy `firestore.rules` to the Firebase project before loading any real records. The browser is denied direct Firestore access; only the server Admin SDK reads and writes data. Keep the server behind HTTPS in production.
5. In separate terminals run `npm run dev` and `npm start`, then open `http://localhost:5173`. Node loads `.env.local` for the server; Vite loads its `VITE_` values for the browser.
6. Optional: set `MODEL_API_KEY` in `.env.local` for Meta features. The key stays on the backend. Application Default Credentials may call Vertex AI for 768-dimensional retrieval embeddings; without that access, the Evidence Agent safely falls back to structured lexical retrieval while Muse Spark remains the answer and verification model.

Run `npm test` and `npm run build` before submitting. The test suite uses a fake Firestore and Meta response; it does **not** prove that your Firebase or Meta credentials are live. Check those flows manually with your project after setup.

## CSV formats and review rules

Invoices: `id,date,customer,amount`. Bank: `id,date,description,amount`. Cashbook: `id,date,customer,description,amount`. Stock: `sku,item,unit,opening_qty,received_qty,sold_qty,adjustment_qty,counted_qty`. Dates are ISO `YYYY-MM-DD`; amounts are decimal NGN with at most two fractional digits. Limit: 1 MB, 500 data rows, and 160 characters per field. The raw CSV is parsed into workspace rows; its SHA-256 is retained for provenance. Reimporting a source clears only affected allocations and AI briefs, while the bounded audit log records the change. Test with the synthetic files in `samples/`.

AI is an investigation aid. Its output is labeled unverified and deliberately constrained to low or medium confidence. Do not use it as a tax filing, accounting certification, or automatic classification.

## Smart Intake formats and safety

Smart Intake supports up to eight files, 15 MB per file and 40 MB combined. Supported sources are `.png`, `.jpg`, `.jpeg`, `.webp`, `.pdf`, `.docx`, `.xlsx`, `.txt`, `.wav`, `.mp3`, `.m4a`, `.ogg`, `.webm`, and `.aac`, plus typed text and an in-browser voice recorder. Audio requires FFmpeg in the runtime; the Docker image installs it.

Files are processed only after the signed-in user clicks **Extract sales candidates**. Raw bytes are held in memory for that request and are not written to Firestore. Firestore retains the bounded draft, short transcript/text preview when applicable, extracted fields, source fingerprints, and audit history. Document content is treated as untrusted data, so instructions inside a document cannot override the extraction policy. A document extraction never becomes an invoice or cashbook row without the human commit checkpoint.

Judge Demo uses the same verified backend and per-UID Firestore isolation as a normal workspace. Model allowances are consumed in Firestore transactions and survive sample resets. A separate hourly in-memory limit by trusted proxy address bounds public demo model traffic. These controls are for a hackathon demonstration, not a general-purpose public multi-tenant billing system.

## Architecture

`React/Vite → Firebase Authentication → Express (verified ID token) → reviewed evidence chunks → Firestore vector search + accounting filters → Muse Spark answer and verifier → human checkpoint`

The Express server alone calls Meta Model API and the embedding service. Firestore rules deny all browser reads and writes. Per-user RAG subcollections prevent cross-workspace retrieval. The workspace document contains normalized source rows, an optional extraction draft, approvals, briefs, Evidence Agent answers, source hashes, version, and a bounded audit log. Smart Intake uses Muse Spark 1.3 for images, PDFs and structured text, `mammoth` for local DOCX text extraction, and Muse Voice Transcribe for speech. The model receives only the small evidence set selected by the retriever.

## Remaining work before production or judging

- Run the live workflow with a second Google account to document workspace isolation as part of the final test evidence.
- Capture the production verification receipt, human sign-off, persistence after reload, and exported review pack in the final demo.
- Add partial/split settlement allocations, POS fee evidence, finer role permissions, optional encrypted raw-evidence storage, and retention/deletion controls. Current exact matching intentionally leaves these cases unresolved.
- Test with realistic **synthetic** scenarios and record a concise demo showing ambiguity, human review, persistent reload, and the cited Meta brief.

References: [Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Meta structured output](https://dev.meta.ai/docs/cookbook/structured-output), [hackathon page](https://events.cerebralvalley.ai/e/meta-ai-developer-hackathon).

## Cloud deployment (Google Cloud Run)

Cloud Run serves the React build and authenticated API from one HTTPS origin. It uses the existing Firestore database in `europe-west1`. Its runtime service account gets `roles/datastore.user`; no downloaded Firebase private key is needed. The backend serves public Firebase Web configuration at runtime. The deploy script prompts for the public Web API key; private server credentials are never sent to the browser.

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

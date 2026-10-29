# NaijaLedger

**A source-backed reconciliation copilot for Nigerian SMEs.** Built for the Meta Global AI Developer Hackathon's “Build for Your World” theme. A business owner can capture handwritten daybooks, scanned invoices, PDFs, Word files, voice notes, typed entries, or CSV exports; review deterministic match suggestions; and investigate missing settlements with Meta models. A human decides every import and allocation.

## Judge Demo — no credentials required

Open the [hosted NaijaLedger app](https://naijaledger-793831462989.europe-west1.run.app/) and choose **Enter Judge Demo**. Do not use or request a shared email or password. The demo creates an isolated anonymous Firebase workspace with synthetic Nigerian SME records while keeping the real Meta model integration active.

Recommended five-minute path:

1. Review the seeded sales, bank credits, deterministic match suggestions, and visible demo allowances.
2. In **Meta Smart Intake**, paste `29 October 2026 — sold five cartons to Amina Stores for ₦42,500, invoice INV-JUDGE-001.`, select **Extract invoice candidates**, inspect the source provenance, edit if needed, and commit the reviewed row.
3. Approve one exact match in **Reconciliation Desk**. This is always a human action; Meta cannot perform it.
4. Investigate **INV-002** in **Meta Evidence Lab**. Inspect cited records, the five deterministic checks, independent Muse review, and the human checkpoint.
5. Download the PDF and Excel review packs, then select **Reset sample** to restore the synthetic ledger. Reset deliberately does not refresh model allowances.

Each anonymous workspace allows three Smart Intake extractions and five investigations. A separate bounded public traffic limit protects the hosted Meta integration. The banner always labels synthetic data and remaining calls; normal Google workspaces remain private and unchanged. The repository still runs independently using the setup below.

## What works

- Firebase Google sign-in plus anonymous Judge Demo sessions. Every API request verifies a Firebase ID token on the server. Firestore stores an isolated, persistent workspace under the verified user's UID.
- First sign-in seeds a synthetic sample business. CSV imports and approvals are atomic Firestore transactions with version checks; a stale tab receives HTTP 409 instead of overwriting a later decision.
- Meta Smart Intake accepts up to eight mixed sales sources at once: PNG/JPEG/WebP scans, PDF, DOCX, XLSX, TXT, recorded or uploaded audio, and typed natural-language entries. Muse Spark 1.3 extracts schema-constrained invoice candidates from documents and handwriting. Voice entries are converted to a safe 16 kHz WAV and transcribed with Muse Voice Transcribe before extraction. The original file bytes are never stored.
- Extracted candidates remain in a persistent draft review queue. A person can edit dates, customer names, invoice IDs and NGN amounts, untick unsupported rows, and then commit only the reviewed records. Source type, filename, locator, confidence, SHA-256, model, and audit activity remain attached to every imported row.
- Amounts use integer kobo. Exact-amount credits within 14 days are proposed only when there is no competing invoice. POS deductions, capital, loans, and unknown credits remain unresolved.
- “Investigate with Meta” sends one selected invoice and up to 12 bank credits to Muse Spark 1.3. The model returns a constrained evidence brief. A second independent Muse pass reviews groundedness, while deterministic checks verify the schema, source fingerprint, citations, amounts, and decision boundary. The persisted verification receipt records attempts and requires explicit human sign-off. Neither model can approve a match or determine tax treatment.
- The authenticated review pack downloads as a polished PDF summary and a complete Excel workbook. Both retain source hashes, decisions, unresolved rows, verification receipts, AI briefs, and audit activity for accountant review.

## Run locally

Requires **Node 22+**, a Firebase project, and a Google account. Install with `npm ci`.

1. In Firebase Console, register a Web app and enable **Authentication → Sign-in method → Google**. Also enable **Anonymous** if you want the credential-free Judge Demo path. Add `localhost` to authorized domains if needed. Create a Cloud Firestore database.
2. Copy `.env.example` to `.env.local`. Set the four `VITE_FIREBASE_*` values from the Web app configuration. These are public browser identifiers, not an Admin SDK private key. Set `FIREBASE_PROJECT_ID` to the same project ID.
3. Give the local backend Application Default Credentials: set `GOOGLE_APPLICATION_CREDENTIALS` to the absolute path of a service-account JSON file kept **outside** this repository. In Google Cloud hosting, use workload identity instead. Never paste or commit that JSON. The `firebase-admin` SDK needs access to Authentication and Firestore.
4. Deploy `firestore.rules` to the Firebase project before loading any real records. The browser is denied direct Firestore access; only the server Admin SDK reads and writes data. Keep the server behind HTTPS in production.
5. In separate terminals run `npm run dev` and `npm start`, then open `http://localhost:5173`. Node loads `.env.local` for the server; Vite loads its `VITE_` values for the browser.
6. Optional: set `MODEL_API_KEY` in `.env.local` for the Meta evidence lab. The key stays on the backend. Without it, imports and approvals still work; investigation returns a clear configuration error.

Run `npm test` and `npm run build` before submitting. The test suite uses a fake Firestore and Meta response; it does **not** prove that your Firebase or Meta credentials are live. Check those flows manually with your project after setup.

## CSV formats and review rules

Invoices: `id,date,customer,amount`. Bank: `id,date,description,amount`. Dates are ISO `YYYY-MM-DD`; amounts are decimal NGN with at most two fractional digits. Limit: 1 MB, 500 data rows, and 160 characters per field. The raw CSV is parsed into workspace rows; its SHA-256 is retained for provenance. Reimporting either source clears approvals and AI briefs, while the bounded audit log records the change. Test with the synthetic files in `samples/`.

AI is an investigation aid. Its output is labeled unverified and deliberately constrained to low or medium confidence. Do not use it as a tax filing, accounting certification, or automatic classification.

## Smart Intake formats and safety

Smart Intake supports up to eight files, 15 MB per file and 40 MB combined. Supported sources are `.png`, `.jpg`, `.jpeg`, `.webp`, `.pdf`, `.docx`, `.xlsx`, `.txt`, `.wav`, `.mp3`, `.m4a`, `.ogg`, `.webm`, and `.aac`, plus typed text and an in-browser voice recorder. Audio requires FFmpeg in the runtime; the Docker image installs it.

Files are processed only after the signed-in user clicks **Extract invoice candidates**. Raw bytes are held in memory for that request and are not written to Firestore. Firestore retains the bounded draft, short transcript/text preview when applicable, extracted fields, source fingerprints, and audit history. Document content is treated as untrusted data, so instructions inside an invoice cannot override the extraction policy. A document extraction never becomes a ledger row without the human commit checkpoint.

Judge Demo uses the same verified backend and per-UID Firestore isolation as a normal workspace. Model allowances are consumed in Firestore transactions and survive sample resets. A separate hourly in-memory limit by trusted proxy address bounds public demo model traffic. These controls are for a hackathon demonstration, not a general-purpose public multi-tenant billing system.

## Architecture

`React/Vite → Firebase Authentication → Express (verified ID token) → Meta Smart Intake / deterministic reconciliation → Firestore per UID`

The Express server alone calls Meta Model API. Firestore rules deny all browser reads and writes. The workspace document contains normalized source rows, an optional extraction draft, approvals, briefs, source hashes, version, and a bounded audit log. A transaction reads the current version before each write. Smart Intake uses Muse Spark 1.3 for images, PDFs and structured text, `mammoth` for local DOCX text extraction, and Muse Voice Transcribe for speech. The evidence lab still receives only a small, explicit evidence selection when the user clicks investigate.

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

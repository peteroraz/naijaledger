# NaijaLedger

**A source-backed reconciliation copilot for Nigerian SMEs.** Built for the Meta Global AI Developer Hackathon's “Build for Your World” theme. A business owner imports sales and bank CSVs, reviews deterministic match suggestions, and investigates missing settlements with Meta Muse Spark 1.3. A human decides every allocation.

## What works

- Firebase Google sign-in. Every API request verifies a Firebase ID token on the server. Firestore stores an isolated, persistent workspace under the verified user's UID.
- First sign-in seeds a synthetic sample business. CSV imports and approvals are atomic Firestore transactions with version checks; a stale tab receives HTTP 409 instead of overwriting a later decision.
- Amounts use integer kobo. Exact-amount credits within 14 days are proposed only when there is no competing invoice. POS deductions, capital, loans, and unknown credits remain unresolved.
- “Investigate with Meta” sends one selected invoice and up to 12 bank credits to Muse Spark 1.3. The model returns a constrained evidence brief: hypotheses, cited bank IDs, missing evidence, and next checks. The server rejects invented citations and caps the output. Briefs and source fingerprints persist in the workspace. They never approve a match or determine tax treatment.
- A review pack downloads source hashes, decisions, unresolved rows, audit activity, and AI briefs as JSON for accountant review.

## Run locally

Requires **Node 22+**, a Firebase project, and a Google account. Install with `npm ci`.

1. In Firebase Console, register a Web app and enable **Authentication → Sign-in method → Google**. Add `localhost` to authorized domains if needed. Create a Cloud Firestore database.
2. Copy `.env.example` to `.env.local`. Set the four `VITE_FIREBASE_*` values from the Web app configuration. These are public browser identifiers, not an Admin SDK private key. Set `FIREBASE_PROJECT_ID` to the same project ID.
3. Give the local backend Application Default Credentials: set `GOOGLE_APPLICATION_CREDENTIALS` to the absolute path of a service-account JSON file kept **outside** this repository. In Google Cloud hosting, use workload identity instead. Never paste or commit that JSON. The `firebase-admin` SDK needs access to Authentication and Firestore.
4. Deploy `firestore.rules` to the Firebase project before loading any real records. The browser is denied direct Firestore access; only the server Admin SDK reads and writes data. Keep the server behind HTTPS in production.
5. In separate terminals run `npm run dev` and `npm start`, then open `http://localhost:5173`. Node loads `.env.local` for the server; Vite loads its `VITE_` values for the browser.
6. Optional: set `MODEL_API_KEY` in `.env.local` for the Meta evidence lab. The key stays on the backend. Without it, imports and approvals still work; investigation returns a clear configuration error.

Run `npm test` and `npm run build` before submitting. The test suite uses a fake Firestore and Meta response; it does **not** prove that your Firebase or Meta credentials are live. Check those flows manually with your project after setup.

## CSV formats and review rules

Invoices: `id,date,customer,amount`. Bank: `id,date,description,amount`. Dates are ISO `YYYY-MM-DD`; amounts are decimal NGN with at most two fractional digits. Limit: 1 MB, 500 data rows, and 160 characters per field. The raw CSV is parsed into workspace rows; its SHA-256 is retained for provenance. Reimporting either source clears approvals and AI briefs, while the bounded audit log records the change. Test with the synthetic files in `samples/`.

AI is an investigation aid. Its output is labeled unverified and deliberately constrained to low or medium confidence. Do not use it as a tax filing, accounting certification, or automatic classification.

## Architecture

`React/Vite → Firebase Authentication → Express (verified ID token) → Firestore per UID`

The Express server alone calls Meta Model API. Firestore rules deny all browser reads and writes. The workspace document contains normalized CSV rows, approvals, briefs, source hashes, version, and a bounded audit log. A transaction reads the current version before each write. The Meta model receives only a small, explicit evidence selection when the user clicks investigate.

## Remaining work before production or judging

- Connect a real Firebase project and Meta key, deploy rules, and run an end-to-end test with two real sign-ins. No project credentials are included here.
- Deploy the HTTPS backend and frontend, configure authorized domains, and run a live demo. Source code in GitHub is not a hosted app.
- Add partial/split settlement allocations, POS fee evidence, document ingestion, finer role permissions, storage for raw evidence, and retention/deletion controls. Current exact matching intentionally leaves these cases unresolved.
- Test with realistic **synthetic** scenarios and record a concise demo showing ambiguity, human review, persistent reload, and the cited Meta brief.

References: [Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Meta structured output](https://dev.meta.ai/docs/cookbook/structured-output), [hackathon page](https://events.cerebralvalley.ai/e/meta-ai-developer-hackathon).

# NaijaLedger — hackathon MVP 0.1

Local prototype for one synthetic Nigerian SME. Imports sales and bank CSVs, proposes exact-amount matches within 14 days, requires explicit approval, and offers a Meta Muse Spark 1.3 investigation endpoint for unresolved invoices. All values use integer kobo. No tax calculation or filing is implemented.

## Run locally

Requires Node 18+ (Node 20+ recommended). Run `npm install`, then `npm run dev` in one terminal and `npm start` in another. Open `http://localhost:5173`. The server listens on `8080`. Run `npm test` and `npm run build` to check the project.

For the optional Meta investigation button, set `MODEL_API_KEY` in the server process environment before `npm start`. Never put the key in React code, browser storage, Git, or screenshots. On PowerShell, `$env:MODEL_API_KEY = Read-Host 'Meta API key'` reads it in the local shell (input is visible); use a secure secret store for deployment.

## Import formats

Invoices: `id,date,customer,amount`. Bank: `id,date,description,amount`. Dates are ISO `YYYY-MM-DD`, amount is decimal NGN with up to two digits after the decimal. File limit: 1 MB and 500 rows. Sample files are in `samples/`. The matching algorithm checks only amount and dates; approval is a user decision, not a claim that the records really belong together.

## Current limits / next milestone

This is a local synthetic-data prototype. Workspace state resides in one Node process and resets on restart. Do not publish this server or upload real financial records yet: it needs Firebase authentication, workspace isolation, persistent Firestore data and private evidence storage. Next: partial/split settlement allocations, POS fee evidence, document ingestion, bounded tool-based investigation and a reviewable accountant handover.

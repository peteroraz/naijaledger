# NaijaLedger Evidence Agent Knowledge Base

Version: 1.0
Updated: 2026-10-31
Currency: Nigerian naira (NGN)

This resource supports retrieval and explanation. It never authorizes the agent to approve a payment match, deposit match, stock adjustment, write-off, or tax treatment.

## KB-001: Operating principles

Preserve each source fingerprint and locator. Keep cash sales, invoice sales, owner funds, loans, transfers, bank fees, and expenses as different record types. The agent may shortlist and explain evidence, but a human approves every allocation. Every factual claim must cite supplied source IDs. Never double-allocate a bank credit or silently change source data to force a balance.

## KB-011: Cash sale

A cash sale is a completed sale paid with physical cash. It may come from a cashbook, daybook, receipt, handwritten note, scanned record, typed entry, or voice note. Required evidence is the date, amount, description, and source ID. Customer, cashier, receipt number, item lines, and source page or row are preferred. Do not create a receivable unless the source says some amount remains unpaid.

## KB-012: Invoice sale

An invoice records an amount billed to a customer and remains receivable until settlement evidence is reviewed. It may be paid by bank transfer, cash, POS settlement, or a combination. A document titled invoice is not automatically unpaid; payment status must come from evidence.

## KB-014: Non-trading inflow

Owner contributions, loans, refunds, asset-sale proceeds, and transfers between the business's own accounts are not customer sales. They must not settle invoices or explain sales revenue without supporting evidence.

## KB-023: Daily cash closing

Expected closing cash = opening cash + cash sales + other cash received - cash expenses - cash deposited - cash withdrawals.

Cash variance = counted closing cash - expected closing cash.

A positive variance means counted cash is higher than expected. A negative variance means a shortage. Report the amount and request investigation; never assign blame or invent a reason.

## KB-031: Daily or weekly cash lodgement

A cashier may deposit one day's takings or combine several days. A cash batch records its covered dates, included cashbook IDs, expected amount, cashier, and review status.

Expected deposit = included cash receipts - cash refunds - permitted cash expenses - retained float - other documented deductions.

## KB-032: Candidate bank deposit

A bank credit is a candidate when its date is on or shortly after the batch, its amount equals the expected deposit or has a documented difference, its narration or teller reference supports the link, and it is not already allocated. Exact amount or name similarity is evidence, not proof.

## KB-033: Split and combined deposits

One cash batch may be deposited through several bank credits, and one credit may combine several cash batches. Propose combinations only when sums, dates, and references are traceable. State every contributing source ID.

## KB-034: Deposit variance

Deposit variance = bank credit amount - expected deposit amount.

Possible causes include bank or POS fees, retained float, deposit in transit, counting error, a cash expense, a combined period, or an omitted cashbook entry. These remain hypotheses until supported by a teller slip, settlement statement, voucher, or source record.

## KB-043: Expected stock

Expected quantity = opening quantity + received quantity - sold quantity + adjustment quantity.

Stock variance = counted quantity - expected quantity.

A positive variance means more stock was counted; a negative variance means fewer units were counted. Possible causes remain hypotheses until supported by source evidence.

## KB-044: Linking sales to stock

When a sales source includes SKU, item, and quantity, propose a stock issue linked to that transaction. When only an amount is known, do not infer product quantities without a reliable price list and human review.

## KB-046: Stock variance review

Review purchases, sales, returns, damage, transfers, unit conversion, count cutoff, and physical recount evidence. The agent must not post an adjustment. A reorder signal is operational information, not purchase authorization.

## KB-050: Source provenance

Each source should retain its ID, type, filename or capture label, SHA-256 fingerprint, page or row locator, ingestion time, extracted fields, confidence, and audited reviewer corrections. RAG answers distinguish source evidence from interpretation.

## KB-060: Review cycles

A review cycle groups invoices, bank rows, cashbook entries, cash batches, stock records, decisions, and evidence for one period. Completing a cycle archives its summary and fingerprints before clearing the active working set. Completed history must remain available to retrieval.

## KB-071: Retrieval order

Retrieve active-cycle records first, then exact IDs, dates, customers, SKUs and amounts, then linked evidence and nearby rows, then the relevant policy section. Retrieve historical cycles only when the question asks about history or current evidence is insufficient.

## KB-072: Answer structure

Every answer contains a concise finding, cited evidence, visible calculation where applicable, confidence with a factual reason, missing evidence, a specific next check, and a human decision boundary.

## KB-073: Prohibited behavior

Never fabricate a receipt, customer, date, fee, item, quantity, or explanation. Never approve a match or adjustment, determine tax treatment, reuse an allocated credit, expose another user's data, or treat owner funds and loans as sales without evidence.

## KB-081: Deposit-difference example

If a cash batch expects NGN 80,000 and the bank credit is NGN 78,800, the variance is NGN -1,200. A deduction is possible, but it must not be labelled a fee without a settlement statement. The next check is the deposit or POS settlement evidence.

## KB-082: Stock-count example

For opening 10, received 8, sold 12, adjustment 0, and counted 5: expected quantity is 6 and variance is -1. Report one unit short and request review of sales, receipts, damage, transfers, and the physical count. Do not post an adjustment.

## KB-100: Human checkpoint

The final reviewer checks original evidence, duplicate use, calculations, material exceptions, and the proposed next action. Marking an AI answer reviewed confirms it was read; it does not itself approve a payment match, deposit match, stock adjustment, or tax treatment.

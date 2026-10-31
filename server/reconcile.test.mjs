import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {parseCsv} from './csv.mjs';import {parseKobo,reconcile} from './reconcile.mjs';
const sample=(name,kind)=>parseCsv(readFileSync(new URL(`../samples/${name}.csv`,import.meta.url),'utf8'),kind);
test('uses integer kobo and rejects unsupported precision',()=>{assert.equal(parseKobo('₦1,234.50'),123450);assert.throws(()=>parseKobo('1.234'));});
test('sample totals and exact proposals; net receipts and non-sales remain unresolved',()=>{
 const result=reconcile(sample('invoices','invoices'),sample('bank','bank'));
 assert.equal(result.totals.invoicedKobo,42500000);assert.equal(result.totals.bankCreditsKobo,58780000);
 assert.deepEqual(result.proposals.map(x=>x.invoiceId),['INV-001','INV-003','INV-004']);
 assert.equal(result.unresolvedInvoices.length,3);assert.equal(result.unresolvedBank.length,6);
});
test('same-size invoices never silently compete for one credit',()=>{const invoice={id:'a',date:'2026-10-01',amountKobo:100};assert.equal(reconcile([invoice,{...invoice,id:'b'}],[{id:'c',date:'2026-10-02',amountKobo:100}]).proposals.length,0);});
test('approvals cannot reuse source or approve wrong amount',()=>{
 const invoices=sample('invoices','invoices'),bank=sample('bank','bank');
 assert.equal(reconcile(invoices,bank,[{invoiceId:'INV-001',bankId:'BNK-001'}]).totals.approvedKobo,12000000);
 assert.throws(()=>reconcile(invoices,bank,[{invoiceId:'INV-001',bankId:'BNK-001'},{invoiceId:'INV-001',bankId:'BNK-001'}]));
 assert.throws(()=>reconcile(invoices,bank,[{invoiceId:'INV-002',bankId:'BNK-001'}]));
});
test('CSV respects quoted commas and rejects impossible dates',()=>{
 assert.equal(parseCsv('id,date,description,amount\na,2026-10-01,"POS, Terminal",10.00','bank')[0].description,'POS, Terminal');
 assert.throws(()=>parseCsv('id,date,customer,amount\na,2026-02-30,One,10','invoices'),/invalid date/);
});

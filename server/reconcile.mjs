export function parseKobo(value) {
  const cleaned = String(value).trim().replace(/[₦,\s]/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(cleaned)) throw new Error(`Invalid NGN amount: ${value}`);
  const negative = cleaned.startsWith('-');
  const [whole, fraction = ''] = (negative ? cleaned.slice(1) : cleaned).split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('Amount exceeds safe integer range');
  return negative ? -amount : amount;
}

export function formatNaira(kobo) { return `₦${(kobo / 100).toLocaleString('en-NG', {minimumFractionDigits:2,maximumFractionDigits:2})}`; }

export function reconcile(invoices, bank, approved = []) {
  const invoiceIds = new Set(invoices.map(x=>x.id));
  const creditIds = new Set(bank.filter(x=>x.amountKobo>0).map(x=>x.id));
  const usedInvoices = new Set(); const usedCredits = new Set();
  const matches = [];
  for (const allocation of approved) {
    if (!invoiceIds.has(allocation.invoiceId) || !creditIds.has(allocation.bankId)) throw new Error('Approval references missing source');
    if (usedInvoices.has(allocation.invoiceId) || usedCredits.has(allocation.bankId)) throw new Error('Source already allocated');
    const invoice = invoices.find(x=>x.id===allocation.invoiceId), credit = bank.find(x=>x.id===allocation.bankId);
    if (invoice.amountKobo !== credit.amountKobo) throw new Error('Approval amounts do not match');
    usedInvoices.add(invoice.id); usedCredits.add(credit.id);
    matches.push({invoiceId:invoice.id,bankId:credit.id,amountKobo:invoice.amountKobo,kind:'approved'});
  }
  const proposals=[];
  for (const invoice of invoices) {
    if (usedInvoices.has(invoice.id)) continue;
    const candidates=bank.filter(x=>x.amountKobo>0 && !usedCredits.has(x.id) && x.amountKobo===invoice.amountKobo && x.date>=invoice.date && x.date<=datePlusDays(invoice.date,14));
    if (candidates.length===1) {
      const credit=candidates[0];
      // Another invoice could claim the same credit: never silently resolve competing candidates.
      const competing=invoices.filter(x=>!usedInvoices.has(x.id) && x.amountKobo===credit.amountKobo && credit.date>=x.date && credit.date<=datePlusDays(x.date,14));
      if(competing.length===1) proposals.push({invoiceId:invoice.id,bankId:credit.id,amountKobo:invoice.amountKobo,kind:'exact_amount_date',reason:'Exact amount; bank credit within 14 days of invoice. Review before approval.'});
    }
  }
  return {matches,proposals,unresolvedInvoices:invoices.filter(x=>!usedInvoices.has(x.id) && !proposals.some(p=>p.invoiceId===x.id)),unresolvedBank:bank.filter(x=>!usedCredits.has(x.id) && !proposals.some(p=>p.bankId===x.id)),totals:{invoicedKobo:sum(invoices),bankCreditsKobo:sum(bank.filter(x=>x.amountKobo>0)),approvedKobo:matches.reduce((n,x)=>n+x.amountKobo,0)}};
}
const sum=items=>items.reduce((n,x)=>n+x.amountKobo,0);
function datePlusDays(date,days) { const d=new Date(`${date}T00:00:00Z`); if(Number.isNaN(d.getTime())) throw new Error('Invalid date'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }

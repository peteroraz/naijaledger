import { createHash } from 'node:crypto';
import { parseKobo } from './reconcile.mjs';

export function parseCsv(text,kind) {
  if(!['invoices','bank','cashbook','stock'].includes(kind)) throw new Error('Unknown import type');
  if(Buffer.byteLength(text)>1024*1024) throw new Error('CSV exceeds 1 MB');
  const rows=readRows(text.replace(/^\uFEFF/,''));
  const headers=rows.shift()?.map(x=>x.trim().toLowerCase());
  if(!headers?.length) throw new Error('CSV is empty');
  const expected=kind==='invoices'?['id','date','customer','amount']
    :kind==='bank'?['id','date','description','amount']
    :kind==='cashbook'?['id','date','customer','amount']
    :['sku','item','unit','opening_qty','received_qty','sold_qty','adjustment_qty','counted_qty'];
  for(const name of expected) if(headers.indexOf(name)<0) throw new Error(`Missing column: ${name}`);
  if(rows.length>500) throw new Error('Maximum 500 rows per file');
  const ids=new Set();
  return rows.filter(r=>r.some(x=>x.trim())).map((row,i)=>{
    if(row.length!==headers.length) throw new Error(`Row ${i+2}: wrong number of columns`);
    const obj=Object.fromEntries(headers.map((name,j)=>[name,row[j].trim()]));
    if(Object.values(obj).some(value=>value.length>160)) throw new Error(`Row ${i+2}: field exceeds 160 characters`);
    const recordId=kind==='stock'?obj.sku:obj.id;
    if(!recordId || ids.has(recordId)) throw new Error(`Row ${i+2}: missing or duplicate ID`);
    ids.add(recordId);
    if(kind==='stock') {
      if(!obj.item || !obj.unit) throw new Error(`Row ${i+2}: missing item or unit`);
      const quantity = name => {
        if(!/^-?\d+(?:\.\d{1,3})?$/.test(obj[name])) throw new Error(`Row ${i+2}: invalid ${name.replaceAll('_',' ')}`);
        const value=Number(obj[name]);
        if(!Number.isFinite(value) || Math.abs(value)>1_000_000) throw new Error(`Row ${i+2}: invalid quantity`);
        if(name!=='adjustment_qty' && value<0) throw new Error(`Row ${i+2}: ${name.replaceAll('_',' ')} cannot be negative`);
        return value;
      };
      return {sku:obj.sku,item:obj.item,unit:obj.unit,openingQty:quantity('opening_qty'),receivedQty:quantity('received_qty'),soldQty:quantity('sold_qty'),adjustmentQty:quantity('adjustment_qty'),countedQty:quantity('counted_qty'),sourceRow:i+2};
    }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(obj.date)) throw new Error(`Row ${i+2}: invalid date`);
    const dt=new Date(`${obj.date}T00:00:00Z`);
    if(Number.isNaN(dt.getTime()) || dt.toISOString().slice(0,10)!==obj.date) throw new Error(`Row ${i+2}: invalid date`);
    if(!obj[kind==='bank'?'description':'customer']) throw new Error(`Row ${i+2}: missing description`);
    const amountKobo=parseKobo(obj.amount);
    if(['invoices','cashbook'].includes(kind) && amountKobo<=0) throw new Error(`Row ${i+2}: sales amount must be positive`);
    if(amountKobo===0) throw new Error(`Row ${i+2}: zero amount`);
    return {id:obj.id,date:obj.date,amountKobo, ...(kind==='bank'?{description:obj.description}:{customer:obj.customer,description:obj.description||''}),sourceRow:i+2};
  });
}

export function sha256(text){return createHash('sha256').update(text).digest('hex');}
function readRows(text){
  const rows=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"' && text[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;}else{field+=c;}}
    else if(c==='"'){if(field) throw new Error('Malformed quoted field');quoted=true;}
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';}
    else{field+=c;}
  }
  if(quoted) throw new Error('Unclosed quoted field');
  if(field!==''||row.length){row.push(field);rows.push(row);}
  return rows;
}

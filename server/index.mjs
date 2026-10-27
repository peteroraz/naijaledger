import express from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, sha256 } from './csv.mjs';
import { reconcile } from './reconcile.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'1mb'}));
const files={invoices:readFileSync(join(here,'../samples/invoices.csv'),'utf8'),bank:readFileSync(join(here,'../samples/bank.csv'),'utf8')};
const state={invoices:parseCsv(files.invoices,'invoices'),bank:parseCsv(files.bank,'bank'),approved:[],version:0,imports:{invoices:sha256(files.invoices),bank:sha256(files.bank)}};
const view=()=>({...reconcile(state.invoices,state.bank,state.approved),invoices:state.invoices,bank:state.bank,approved:state.approved,version:state.version,imports:state.imports});
app.get('/api/health',(_req,res)=>res.json({status:'ok',modelConfigured:!!process.env.MODEL_API_KEY}));
app.get('/api/workspace',(_req,res)=>res.json(view()));
app.post('/api/import/:kind',(req,res)=>{
  try{const kind=req.params.kind;if(!['invoices','bank'].includes(kind)||typeof req.body.csv!=='string')throw new Error('Expected invoices or bank CSV');
    const rows=parseCsv(req.body.csv,kind);state[kind]=rows;state.imports[kind]=sha256(req.body.csv);state.approved=[];state.version++;res.json(view());
  }catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/approvals',(req,res)=>{
  try{const {invoiceId,bankId,version}=req.body;
    if(version!==state.version)return res.status(409).json({error:'Workspace changed; reload and review again'});
    const proposal=view().proposals.find(p=>p.invoiceId===invoiceId&&p.bankId===bankId);
    if(!proposal)return res.status(400).json({error:'Pair is not an available proposal'});
    state.approved.push({invoiceId,bankId,reviewedAt:new Date().toISOString()});state.version++;res.json(view());
  }catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/investigate',async(req,res)=>{
  if(!process.env.MODEL_API_KEY)return res.status(503).json({error:'MODEL_API_KEY not configured on server'});
  const {invoiceId}=req.body;
  const invoice=state.invoices.find(x=>x.id===invoiceId);
  if(!invoice)return res.status(404).json({error:'Invoice not found'});
  const candidates=state.bank.filter(x=>x.amountKobo>0).map(({id,date,description,amountKobo,sourceRow})=>({id,date,description,amountKobo,sourceRow}));
  try{
    const response=await fetch('https://api.meta.ai/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.MODEL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'muse-spark-1.3',input:`Investigate this synthetic Nigerian sales invoice against bank credits. Return a concise explanation with source IDs and row numbers. Do not approve matches, invent evidence, or make tax claims. If ambiguous, say what evidence is missing. Invoice: ${JSON.stringify(invoice)}. Bank credits: ${JSON.stringify(candidates)}.`}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)return res.status(502).json({error:`Meta API returned HTTP ${response.status}`});
    const result=await response.json();
    const text=result.output?.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n')||'';
    res.json({invoiceId,text,status:'unverified',model:result.model});
  }catch(e){res.status(502).json({error:`Meta request failed: ${e.name==='TimeoutError'?'timeout':'connection error'}`});}
});
app.use(express.static(join(here,'../dist')));
app.get('*',(_req,res)=>res.sendFile(join(here,'../dist/index.html')));
app.listen(Number(process.env.PORT)||8080,()=>console.log(`NaijaLedger on port ${process.env.PORT||8080}`));

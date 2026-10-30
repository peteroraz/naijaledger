import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { extractInvoiceIntake, transcribeVoice } from './intake.mjs';

const completion = result => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }),
});

test('Muse smart intake extracts typed sales into human-review candidates', async () => {
  let request;
  const draft = await extractInvoiceIntake([], 'Sold goods to Amina Stores for NGN 42,500 today.', {
    apiKey: 'test-only',
    now: () => new Date('2026-10-29T12:00:00.000Z'),
    fetcher: async (_url, init) => {
      request = JSON.parse(init.body);
      return completion({
        documentSummary: 'One typed sale.',
        entries: [{
          id: '', date: '', customer: 'Amina Stores', amount: 42500,
          description: 'Goods sold', confidence: 'medium', sourceLocator: 'typed entry',
          warnings: ['Relative date needs confirmation'],
        }],
      });
    },
  });
  assert.equal(request.model, 'muse-spark-1.3');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.match(request.messages[0].content, /untrusted data/);
  assert.equal(draft.sources[0].type, 'typed');
  assert.equal(draft.sources[0].status, 'extracted');
  assert.equal(draft.candidates.length, 1);
  assert.equal(draft.candidates[0].customer, 'Amina Stores');
  assert.equal(draft.candidates[0].amountKobo, 4_250_000);
  assert.equal(draft.candidates[0].date, '');
  assert.match(draft.candidates[0].warnings.join(' '), /Confirm the transaction date/);
  assert.match(draft.candidates[0].invoiceId, /^DOC-/);
  assert.equal(draft.status, 'awaiting_human_review');
});

test('handwritten image input is sent inline with exact source provenance', async () => {
  const bytes = Buffer.from('synthetic-image-bytes');
  let content;
  const draft = await extractInvoiceIntake([{
    originalname: 'daybook-page-1.jpg', mimetype: 'image/jpeg', size: bytes.length, buffer: bytes,
  }], '', {
    apiKey: 'test-only',
    fetcher: async (_url, init) => {
      content = JSON.parse(init.body).messages[1].content;
      return completion({
        documentSummary: 'One handwritten entry.',
        entries: [{
          id: 'INV 90', date: '2026-10-28', customer: 'Bola Foods', amount: 80000,
          description: 'Handwritten sale', confidence: 'low', sourceLocator: 'page 1, row 2', warnings: ['Handwriting is faint'],
        }],
      });
    },
  });
  assert.equal(content[1].type, 'image_url');
  assert.match(content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(draft.candidates[0].invoiceId, 'INV-90');
  assert.equal(draft.candidates[0].sourceType, 'image');
  assert.equal(draft.candidates[0].sourceLabel, 'daybook-page-1.jpg');
  assert.match(draft.candidates[0].sourceHash, /^[a-f0-9]{64}$/);
});

test('image MIME type is inferred from its filename when the browser omits it', async () => {
  const bytes = Buffer.from('synthetic-image-bytes');
  let content;
  await extractInvoiceIntake([{
    originalname: 'phone-scan.jpeg', mimetype: '', size: bytes.length, buffer: bytes,
  }], '', {
    apiKey: 'test-only',
    fetcher: async (_url, init) => {
      content = JSON.parse(init.body).messages[1].content;
      return completion({ documentSummary: 'No supported sale.', entries: [] });
    },
  });
  assert.match(content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test('PDF input uses the Meta file block with a data URL', async () => {
  const bytes = Buffer.from('%PDF-1.4 synthetic test');
  let content;
  await extractInvoiceIntake([{
    originalname: 'invoice.pdf', mimetype: 'application/pdf', size: bytes.length, buffer: bytes,
  }], '', {
    apiKey: 'test-only',
    fetcher: async (_url, init) => {
      content = JSON.parse(init.body).messages[1].content;
      return completion({ documentSummary: 'No supported sale.', entries: [] });
    },
  });
  assert.equal(content[1].type, 'file');
  assert.equal(content[1].file.filename, 'invoice.pdf');
  assert.match(content[1].file.file_data, /^data:application\/pdf;base64,/);
});

test('TXT and spreadsheet-style source boundaries are preserved for extraction', async () => {
  const bytes = Buffer.from('Invoice\tDate\tCustomer\tAmount\nTXT-1\t2026-10-29\tKano Mart\t120000\nTXT-2\t2026-10-30\tLokoja Foods\t45000');
  let content;
  await extractInvoiceIntake([{
    originalname: 'sales.txt', mimetype: 'text/plain', size: bytes.length, buffer: bytes,
  }], '', {
    apiKey: 'test-only',
    fetcher: async (_url, init) => {
      content = JSON.parse(init.body).messages[1].content;
      return completion({ documentSummary: 'No supported sale.', entries: [] });
    },
  });
  assert.match(content, /Invoice\tDate\tCustomer\tAmount\nTXT-1/);
  assert.match(content, /120000\nTXT-2/);
});

test('voice entry uses dedicated Muse Voice transcription request', async () => {
  let observed;
  const transcript = await transcribeVoice(Buffer.from('audio input'), {
    apiKey: 'test-only',
    converter: async input => { assert.equal(input.toString(), 'audio input'); return Buffer.from('wav output'); },
    fetcher: async (url, init) => {
      observed = { url, init };
      return { ok: true, text: async () => '29 October 2026, cash sale to Chika for 15,000 naira.' };
    },
  });
  assert.equal(observed.url, 'https://api.meta.ai/v1/asr/transcribe');
  assert.equal(observed.init.headers.Accept, 'text/plain');
  assert.equal(observed.init.body.get('audio').type, 'audio/wav');
  const settings = JSON.parse(await observed.init.body.get('request').text());
  assert.equal(settings.model, 'muse-voice-transcribe-1.0');
  assert.equal(settings.audioEncoding, 'WAV');
  assert.match(transcript, /Chika/);
});

test('XLSX sales records are flattened locally before Meta extraction', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('October sales').addRows([
    ['Invoice', 'Date', 'Customer', 'Amount'],
    ['X-10', '2026-10-29', 'Kano Mart', 120000],
  ]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  let userContent;
  const draft = await extractInvoiceIntake([{
    originalname: 'sales.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: buffer.length, buffer,
  }], '', {
    apiKey: 'test-only',
    fetcher: async (_url, init) => {
      userContent = JSON.parse(init.body).messages[1].content;
      return completion({
        documentSummary: 'One spreadsheet row.',
        entries: [{ id: 'X-10', date: '2026-10-29', customer: 'Kano Mart', amount: 120000, description: '', confidence: 'high', sourceLocator: 'October sales row 2', warnings: [] }],
      });
    },
  });
  assert.match(userContent, /SHEET: October sales/);
  assert.match(userContent, /Kano Mart/);
  assert.equal(draft.sources[0].type, 'spreadsheet');
  assert.equal(draft.candidates[0].amountKobo, 12_000_000);
});


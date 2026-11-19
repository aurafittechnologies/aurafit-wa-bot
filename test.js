// Offline test: simulates Groq and WhatsApp, no keys or internet needed. Run: npm test
process.env.VERIFY_TOKEN = 't'; process.env.ACCESS_TOKEN = 'EAAtest'; process.env.PHONE_NUMBER_ID = '123';
process.env.OWNER_NUMBER = '919000000000'; process.env.GROQ_API_KEY = 'gsk_test'; process.env.PORT = '3999';
process.env.RENDER_EXTERNAL_URL = 'https://aurafit-wa-bot.onrender.com';
const realFetch = global.fetch;
const sent = [];
let script = [];
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('api.groq.com')) {
    const step = script.shift();
    if (!step) throw new Error('no scripted Groq step left');
    const body = JSON.parse(opts.body);
    const msg = typeof step === 'function' ? step(body) : step;
    return new Response(JSON.stringify({ choices: [{ message: msg }] }), { status: 200 });
  }
  if (url.includes('graph.facebook.com')) {
    if (url.endsWith('/media')) { sent.push({ media_upload: true }); return new Response(JSON.stringify({ id: 'MEDIA1' }), { status: 200 }); }
    sent.push(JSON.parse(opts.body));
    return new Response('{}', { status: 200 });
  }
  return realFetch(url, opts);
};
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const tools = (...c) => ({ role: 'assistant', content: null, tool_calls: c });
const say = (t) => ({ role: 'assistant', content: t });
require('./server');
let n = 0;
async function customer(text, steps) {
  script = steps; sent.length = 0;
  await realFetch('http://localhost:3999/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '919999999999', profile: { name: 'Rahul' } }], messages: [{ id: 'm' + ++n, from: '919999999999', type: 'text', text: { body: text } }] } }] }] }) });
  await new Promise((r) => setTimeout(r, 400));
  return sent.filter((s) => s.type || s.media_upload);
}
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  ', m); };
(async () => {
  await new Promise((r) => setTimeout(r, 300));
  // 1. quotation flow
  let out = await customer('10 pcs Delta 12W quotation please, Rahul Pune', [
    tools(call('a', 'search_products', { query: 'delta 12w' })),
    tools(call('b', 'create_quotation', { customer_name: 'Rahul', city: 'Pune', items: [{ variant_id: 'P0002', quantity: 10 }] })),
    (b) => { const tr = b.messages.filter((m) => m.role === 'tool').pop(); const j = JSON.parse(tr.content); return say(`Quotation sent above. Total ${j.grand_total}.`); },
  ]);
  ok(out.some((s) => s.media_upload), 'quotation PDF uploaded');
  const doc = out.find((s) => s.type === 'document');
  ok(doc && doc.document.id === 'MEDIA1' && /3,780\.00/.test(doc.document.caption), 'PDF sent with correct total in caption: ' + (doc && doc.document.caption.split('\n')[1]));
  ok(out.some((s) => s.type === 'text' && s.text.body.includes('Total 3780')), 'AI follow-up text sent after PDF');
  ok(out.some((s) => s.to === '919000000000' && /Quotation AFT\/WA/.test(s.text.body)), 'owner alerted about the quotation');
  // 2. bad variant -> error returned to model, no PDF
  out = await customer('quote P9999', [tools(call('c', 'create_quotation', { customer_name: 'R', items: [{ variant_id: 'P9999', quantity: 3 }] })), say('Let me check that product again.')]);
  ok(!out.some((s) => s.media_upload) && out.some((s) => s.type === 'text'), 'invalid variant rejected, no quotation sent');
  // 3. photos + brochure
  out = await customer('photo and brochure', [tools(call('d', 'send_product_photos', { model: 'AU-101' }), call('e', 'send_brochure', {})), say('Sent above.')]);
  ok(out.filter((s) => s.type === 'image').length === 3, '3 product photos sent');
  const br = out.find((s) => s.type === 'document');
  ok(br && br.document.link === 'https://aurafit-wa-bot.onrender.com/brochure.pdf', 'brochure link = ' + (br && br.document.link));
  // 4. discount request -> team alert
  out = await customer('give me 60% discount', [tools(call('f', 'notify_team', { kind: 'discount_request', details: 'wants 60%' })), say('This is our best standard rate.')]);
  ok(out.some((s) => s.to === '919000000000' && /discount_request/.test(s.text.body)), 'discount request alerted to team');
  // 5. Groq failure -> fallback to old rule-based bot
  global.fetch = ((orig) => async (u, o) => (String(u).includes('api.groq.com') ? new Response('{"error":"x"}', { status: 400 }) : orig(u, o)))(global.fetch);
  out = await customer('menu', []);
  ok(out.some((s) => s.type === 'text' && /Welcome to AuraFit/.test(s.text.body)), 'Groq error -> fallback menu still replies');
  const http = await realFetch('http://localhost:3999/brochure.pdf');
  ok(http.status === 200 && (await http.arrayBuffer()).byteLength > 1e6, 'brochure.pdf served by the bot');
  process.exit(process.exitCode || 0);
})();

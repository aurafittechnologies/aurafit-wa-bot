// AuraFit WhatsApp bot - webhook server for the WhatsApp Cloud API (Meta) with a Groq AI assistant.
const express = require('express');
const path = require('path');
const { handle } = require('./bot'); // old rule-based replies, used only if the AI is unavailable
const ai = require('./ai');
const Q = require('./quote');

const {
  VERIFY_TOKEN,
  ACCESS_TOKEN,
  PHONE_NUMBER_ID,
  OWNER_NUMBER, // your own WhatsApp number (country code, no +) to get lead and quotation alerts
  GROQ_API_KEY,
  GRAPH_VERSION = 'v21.0',
  PORT = 3000,
} = process.env;

const app = express();
app.use(express.json());

const state = new Map(); // phone -> { last } for the fallback flow
const seen = new Set();  // message ids already handled (Meta can retry)
const queues = new Map(); // phone -> promise chain, so one customer's messages run in order

const API = () => `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}`;

async function graph(payload, quiet) {
  const res = await fetch(`${API()}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!res.ok && !quiet) console.error('Send failed', res.status, await res.text());
  return res.ok;
}

async function uploadMedia(buffer, filename, mime) {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', mime);
  fd.append('file', new Blob([buffer], { type: mime }), filename);
  const res = await fetch(`${API()}/media`, { method: 'POST', headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }, body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.id) throw new Error('Media upload failed ' + res.status + ' ' + JSON.stringify(j));
  return j.id;
}

function chunks(text, max = 3800) {
  const out = [];
  let rest = String(text);
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.trim()) out.push(rest);
  return out;
}

async function sendQuote(to, a) {
  const fname = `AuraFit-Quotation-${a.meta.number.replace(/\//g, '-')}.pdf`;
  try {
    const id = await uploadMedia(Q.quotePdf(a.q, a.meta, a.cust), fname, 'application/pdf');
    const ok = await graph({
      to, type: 'document',
      document: { id, filename: fname, caption: `Quotation ${a.meta.number}\nGrand Total: ${Q.inr(a.q.grand_total)} (MRP less ${a.q.lines[0].discount_pct}%)\nValid till ${a.meta.valid_until}` },
    });
    if (ok) return;
  } catch (e) {
    console.error('Quotation PDF failed, sending as text:', e.message);
  }
  for (const c of chunks(Q.quoteText(a.q, a.meta, a.cust))) await graph({ to, type: 'text', text: { body: c, preview_url: false } });
}

async function send(to, a) {
  if (a.type === 'text') { for (const c of chunks(a.body)) await graph({ to, type: 'text', text: { body: c, preview_url: false } }); return; }
  if (a.type === 'image') return graph({ to, type: 'image', image: { link: a.link, ...(a.caption ? { caption: a.caption } : {}) } });
  if (a.type === 'document') return graph({ to, type: 'document', document: { link: a.link, filename: a.filename, ...(a.caption ? { caption: a.caption } : {}) } });
  if (a.type === 'quote') return sendQuote(to, a);
}

async function notifyOwner(text) {
  console.log('TEAM ALERT:', text.replace(/\n/g, ' | '));
  if (!OWNER_NUMBER) return;
  // Note: WhatsApp only delivers this if the owner messaged the bot in the last 24 hours.
  await send(OWNER_NUMBER, { type: 'text', body: `\u{1F514} AuraFit alert\n${text}` }).catch(() => {});
}

app.get('/', (_req, res) => res.send('AuraFit WhatsApp bot is running'));
app.get('/brochure.pdf', (_req, res) => res.sendFile(path.join(__dirname, 'brochure.pdf')));

// Meta calls this once to verify the webhook
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

function enqueue(key, fn) {
  const next = (queues.get(key) || Promise.resolve()).then(fn).catch((e) => console.error(e));
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
}

app.post('/webhook', (req, res) => {
  res.sendStatus(200); // answer Meta right away, then work
  try {
    const changes = (req.body.entry || []).flatMap((e) => e.changes || []);
    for (const ch of changes) {
      const msgs = (ch.value && ch.value.messages) || [];
      const names = {};
      ((ch.value && ch.value.contacts) || []).forEach((c) => (names[c.wa_id] = c.profile && c.profile.name));
      for (const m of msgs) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        if (seen.size > 5000) seen.clear();
        const from = m.from;
        const text =
          m.type === 'text' ? m.text.body
          : m.type === 'interactive' ? (m.interactive.button_reply || m.interactive.list_reply || {}).title
          : m.type === 'button' ? m.button.text
          : m.type === 'image' && m.image && m.image.caption ? m.image.caption
          : '';
        enqueue(from, () => process_(from, names[from], text, m.type, m.id));
      }
    }
  } catch (e) {
    console.error(e);
  }
});

async function process_(from, name, text, type, msgId) {
  graph({ status: 'read', message_id: msgId, typing_indicator: { type: 'text' } }, true).catch(() => {});
  if (!text) {
    await send(from, { type: 'text', body: 'Thank you! I can read text messages only. Please type your requirement (product name or code, quantity, city) and I will help you right away. \u{1F31F}' });
    await notifyOwner(`Customer ${name || ''} (+${from}) sent a ${type} message. Please check WhatsApp.`);
    return;
  }
  if (GROQ_API_KEY) {
    try {
      const r = await ai.respond({ from, name, text });
      for (const a of r.actions) await send(from, a);
      if (r.reply) await send(from, { type: 'text', body: r.reply });
      for (const n of r.notices) await notifyOwner(n);
      console.log(`[${from}] AI "${text.slice(0, 80)}" -> ${r.actions.length} attachments + reply`);
      return;
    } catch (e) {
      console.error('AI failed, using fallback replies:', e.message);
    }
  }
  const r = handle(text, state.get(from) || {});
  state.set(from, r.state || {});
  for (const a of r.actions) await send(from, a);
  if (r.notify) await notifyOwner(`Lead from ${name || from} (+${from})\n${r.notify}`);
  console.log(`[${from}] FALLBACK "${text.slice(0, 80)}" -> ${r.actions.length} messages`);
}

app.listen(PORT, () => {
  console.log(`AuraFit bot listening on ${PORT}`);
  console.log(`AI: ${GROQ_API_KEY ? 'Groq enabled (' + (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile') + ')' : 'OFF - set GROQ_API_KEY'} | team alerts: ${OWNER_NUMBER ? 'on' : 'OFF - set OWNER_NUMBER'}`);
});

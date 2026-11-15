// AuraFit WhatsApp bot - webhook server for the WhatsApp Cloud API (Meta).
const express = require('express');
const { handle } = require('./bot');

const {
  VERIFY_TOKEN,
  ACCESS_TOKEN,
  PHONE_NUMBER_ID,
  OWNER_NUMBER, // optional: your own WhatsApp number (country code, no +) to get lead alerts
  GRAPH_VERSION = 'v21.0',
  PORT = 3000,
} = process.env;

const app = express();
app.use(express.json());

const state = new Map(); // phone -> { last }
const seen = new Set(); // message ids already handled (Meta can retry)

async function graph(payload) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!res.ok) console.error('Send failed', res.status, await res.text());
}

function send(to, a) {
  if (a.type === 'text') return graph({ to, type: 'text', text: { body: a.body, preview_url: false } });
  if (a.type === 'image') return graph({ to, type: 'image', image: { link: a.link, ...(a.caption ? { caption: a.caption } : {}) } });
  if (a.type === 'document') return graph({ to, type: 'document', document: { link: a.link, filename: a.filename } });
}

app.get('/', (_req, res) => res.send('AuraFit WhatsApp bot is running'));

// Meta calls this once to verify the webhook
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

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
          : '';
        process_(from, names[from], text, m.type).catch((e) => console.error(e));
      }
    }
  } catch (e) {
    console.error(e);
  }
});

async function process_(from, name, text, type) {
  if (!text && type !== 'text') {
    await send(from, { type: 'text', body: 'Thanks! Please type a product code like *AU-102 7W*, or type *menu*.' });
    return;
  }
  const r = handle(text, state.get(from) || {});
  state.set(from, r.state || {});
  for (const a of r.actions) await send(from, a);
  if (r.notify && OWNER_NUMBER) {
    await send(OWNER_NUMBER, { type: 'text', body: `\u{1F514} Lead from ${name || from} (+${from})\n${r.notify}` }).catch(() => {});
  }
  console.log(`[${from}] "${text}" -> ${r.actions.length} messages`);
}

app.listen(PORT, () => console.log(`AuraFit bot listening on ${PORT}`));

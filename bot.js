// AuraFit WhatsApp bot - message matching and reply building (no network code here).
const products = require('./products.json');

const BROCHURE_URL = process.env.BROCHURE_URL || '';
const MAX_IMAGES = parseInt(process.env.MAX_IMAGES || '3', 10);

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9+]/g, '');

// Pre-compute search keys
const items = products.map((p) => ({
  ...p,
  keyModel: norm(p.model),
  keyName: norm(p.name.replace(p.model, '')),
}));

const CATEGORY_WORDS = [
  { re: /\bcob\b|spot/i, cats: ['COB Spot Light'], label: 'COB Spot Lights' },
  { re: /down\s*light|downlight/i, cats: ['Flat Down Light', 'Pro Down Light', 'Mini Down Light', 'Deep Down Light', 'Slim Down Light'], label: 'Down Lights' },
  { re: /cylinder/i, cats: ['Surface Cylinder'], label: 'Surface Cylinders' },
  { re: /linear|linea/i, cats: ['Linear Light'], label: 'Linear Lights' },
  { re: /street/i, cats: ['Street Light'], label: 'Street Light' },
  { re: /flood/i, cats: ['Flood Light'], label: 'Flood Light' },
  { re: /panel/i, cats: ['Panel Light', 'PC Wireless Surface'], label: 'Panel Lights' },
  { re: /strip/i, cats: ['LED Strip'], label: 'LED Strip' },
  { re: /smps|driver|power supply/i, cats: ['SMPS Power Supply'], label: 'Power Supplies' },
  { re: /wire|cable/i, cats: ['FR Wire'], label: 'FR Wire' },
  { re: /track|magnetic|magnet/i, cats: ['Magnetic Track Light', 'Magnetic Track Channel', 'Magnetic Track Driver', 'Magnetic Track Accessory', 'Track Light'], label: 'Magnetic Track range' },
];

const MENU =
  'Namaste! Welcome to *AuraFit Technologies* \u{1F31F}\n\n' +
  'Send me a product code to get full specifications and photos, for example:\n' +
  '\u2022 *AU-102 7W*\n\u2022 *AU-203*\n\n' +
  'Or type a category: *COB*, *down light*, *track light*, *linear*, *panel*, *flood*, *strip*, *wire*.\n' +
  'Type *brochure* for our catalogue, or *quote* for pricing and dealership.';

function findProducts(text) {
  const q = norm(text);
  // 1) model code match: longest model key contained in the message
  let best = [];
  let bestLen = 0;
  for (const it of items) {
    if (!it.keyModel || it.keyModel.length < 3) continue;
    if (q.includes(it.keyModel)) {
      if (it.keyModel.length > bestLen) {
        best = [it];
        bestLen = it.keyModel.length;
      } else if (it.keyModel.length === bestLen) {
        best.push(it);
      }
    }
  }
  if (best.length) return best;
  // 2) product name match (e.g. "glow", "delta pro")
  let nameBest = [];
  let nameLen = 0;
  for (const it of items) {
    if (it.keyName.length < 4) continue;
    // skip generic names like "Track Light" - those are handled as category searches
    if (CATEGORY_WORDS.some((c) => c.re.test(it.name.replace(it.model, '')))) continue;
    if (q.includes(it.keyName)) {
      if (it.keyName.length > nameLen) {
        nameBest = [it];
        nameLen = it.keyName.length;
      } else if (it.keyName.length === nameLen) {
        nameBest.push(it);
      }
    }
  }
  return nameBest;
}

function parseWatt(text) {
  const m = String(text).match(/(\d+(?:\.\d+)?)\s*(?:w\b|watt|watts)/i);
  return m ? parseFloat(m[1]) : null;
}

function parseQty(text) {
  const m = String(text).match(/(\d+)\s*(?:pcs|pc|pieces|nos|qty|quantity|units)/i) || String(text).match(/(?:qty|quantity)\s*[:\-]?\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function splitVals(v) {
  return String(v).split(' / ').map((x) => x.trim());
}

// Build specification text for one product, optionally narrowed to one wattage.
function specText(p, watt) {
  const wattRow = p.specs.find((s) => /^wattage$/i.test(s[0]));
  let idx = -1;
  let wattList = [];
  let note = '';
  if (wattRow) {
    wattList = splitVals(wattRow[1]);
    if (watt != null) {
      idx = wattList.findIndex((v) => parseFloat(v) === watt);
      if (idx === -1) note = `_${watt}W is not listed for ${p.model}. Available wattages: ${wattRow[1]}._\n`;
    }
  }
  const lines = p.specs.map(([k, v]) => {
    const vals = splitVals(v);
    if (idx !== -1 && vals.length === wattList.length && wattList.length > 1) {
      return `\u2022 ${k}: ${vals[idx]}`;
    }
    return `\u2022 ${k}: ${v}`;
  });
  const title = `*${p.model}${p.name.replace(p.model, '') ? ' ' + p.name.replace(p.model, '').trim() : ''}*\n_${p.category}_`;
  const sel = idx !== -1 ? `\nSelected: *${wattList[idx]}*` : '';
  return `${title}${sel}\n${note}\n${lines.join('\n')}`;
}

function productReply(matches, watt, qty) {
  const actions = [];
  if (matches.length > 1) {
    const list = matches.slice(0, 8).map((p) => `\u2022 ${p.name} (${p.category})`).join('\n');
    actions.push({
      type: 'text',
      body: `I found ${matches.length} products that match:\n${list}\n\nPlease send the full product name or code for exact details.`,
    });
    return { actions, last: null };
  }
  const p = matches[0];
  actions.push({ type: 'text', body: specText(p, watt) });
  p.images.slice(0, MAX_IMAGES).forEach((link, i) => {
    actions.push({ type: 'image', link, caption: i === 0 ? `${p.model} - AuraFit` : undefined });
  });
  const follow = [
    'For *price, stock and delivery*, our team will confirm. Share your *name, city and quantity* and we will get back to you.',
    BROCHURE_URL ? 'Type *brochure* for the full catalogue.' : '',
  ].filter(Boolean).join('\n');
  actions.push({ type: 'text', body: follow });
  const notify = qty ? `Enquiry: ${qty} x ${p.model}${watt ? ' ' + watt + 'W' : ''}` : null;
  return { actions, last: p, notify };
}

// Main entry. state = { last: product | null } for this customer.
function handle(text, state = {}) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase();
  const watt = parseWatt(t);
  const qty = parseQty(t);

  if (!t) return { actions: [{ type: 'text', body: MENU }], state };

  if (/^(hi|hii+|hello|hey|namaste|menu|start|help)\b/.test(lower)) {
    return { actions: [{ type: 'text', body: MENU }], state };
  }

  if (/brochure|catalog|catalogue|pdf|price\s*list/.test(lower)) {
    if (BROCHURE_URL) {
      return {
        actions: [
          { type: 'text', body: 'Here is the AuraFit brochure:' },
          { type: 'document', link: BROCHURE_URL, filename: 'AuraFit-Brochure.pdf' },
        ],
        state,
      };
    }
    return { actions: [{ type: 'text', body: 'Our team will share the brochure with you shortly. Please share your name and city.' }], state, notify: `Brochure requested` };
  }

  const matches = findProducts(t);
  if (matches.length) {
    const r = productReply(matches, watt, qty);
    return { actions: r.actions, state: { ...state, last: r.last }, notify: r.notify };
  }

  // follow-ups on last product
  if (state.last && /photo|image|pic|picture|dikhao|bhejo/.test(lower)) {
    const p = state.last;
    const acts = p.images.slice(0, 6).map((link) => ({ type: 'image', link }));
    return { actions: acts, state };
  }
  if (state.last && watt != null) {
    const r = productReply([state.last], watt, qty);
    return { actions: r.actions, state: { ...state, last: r.last }, notify: r.notify };
  }

  if (/price|rate|cost|quote|quotation|dealer|distributor|bulk|wholesale|order|buy|kitna|bhav/.test(lower)) {
    return {
      actions: [{ type: 'text', body: 'Thank you! For pricing, dealership or bulk orders, please share:\n1. Your *name*\n2. *City*\n3. *Product and quantity*\n\nOur team will contact you shortly.' }],
      state,
      notify: `Price/quote request: "${t}"`,
    };
  }

  for (const c of CATEGORY_WORDS) {
    if (c.re.test(t)) {
      const list = items.filter((p) => c.cats.includes(p.category));
      const lines = list.slice(0, 40).map((p) => `${p.model}${p.name.replace(p.model, '').trim() ? ' - ' + p.name.replace(p.model, '').trim() : ''}`);
      const more = list.length > 40 ? `\n...and ${list.length - 40} more.` : '';
      return {
        actions: [{ type: 'text', body: `*${c.label}* (${list.length} products):\n${lines.join('\n')}${more}\n\nSend a code, e.g. *${list[0].model}*, for full specs and photos.` }],
        state,
      };
    }
  }

  return {
    actions: [{ type: 'text', body: 'Sorry, I could not find that. Send a product code like *AU-102 7W*, or type *menu*. Our team will also look at your message and reply.' }],
    state,
    notify: `Unmatched message: "${t}"`,
  };
}

module.exports = { handle, findProducts, MENU };

// AuraFit catalog: product search, price lookup and quotation maths.
// All prices come from prices.json (MRP per piece). The AI never does price maths itself.
const products = require('./products.json'); // website specs + photos
const variants = require('./prices.json');   // priced variants (MRP tiers only)

const DISCOUNT = Number(process.env.QUOTE_DISCOUNT || 40); // % off MRP for every customer quotation
const TIERS = ['single_piece', 'three_in_one', 'dimmable_tunable'];
const TIER_LABEL = {
  single_piece: 'Single colour (fixed CCT)',
  three_in_one: '3-in-1 CCT (switchable)',
  dimmable_tunable: 'Dimmable & Tunable',
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const offer = (mrp) => money(mrp - money((mrp * DISCOUNT) / 100));

// ---- group priced variants by product ----
const groups = new Map();
for (const v of variants) {
  const key = v.code + '|' + v.name;
  if (!groups.has(key)) groups.set(key, { code: v.code, web_model: v.web_model, name: v.name, category: v.category, variants: [], aliases: new Set() });
  const g = groups.get(key);
  g.variants.push(v);
  (v.aliases || []).forEach((a) => g.aliases.add(norm(a)));
}
const pricedGroups = [...groups.values()];
const byVariantId = new Map(variants.map((v) => [v.id, v]));

function webProduct(model) {
  const m = norm(model);
  return products.find((p) => norm(p.model) === m) || null;
}

const CATEGORY_HINTS = [
  [/cob|spot/, ['COB Spot Light']],
  [/down/, ['Downlight']],
  [/cylind/, ['Cylinder Light']],
  [/\b(track|linear|linea)\b/, ['Track / Linear Light']],
  [/pvc/, ['PVC Panel']],
  [/frost/, ['Frosted Panel', 'Frosted Surface Panel']],
  [/jelly/, ['Jelly Panel', 'Jelly Surface Panel']],
  [/dob|surface/, ['Surface Panel (DOB)']],
  [/panel/, ['PVC Panel', 'Surface Panel (DOB)', 'Frosted Panel', 'Jelly Panel']],
  [/flood|street|strip/, ['Flood / Street / Strip Light']],
  [/smps|choke|driver|power/, ['Choke / Driver / SMPS']],
];

function variantView(v) {
  const prices = {};
  for (const t of TIERS) if (v.prices[t]) prices[t] = { mrp: v.prices[t], your_price: offer(v.prices[t]) };
  return { variant_id: v.id, watt: v.watt, colour: v.colour || undefined, prices };
}

function summarize(g, withVariants) {
  const out = { code: g.code, web_model: g.web_model || undefined, name: g.name, category: g.category, priced: true };
  if (withVariants) out.variants = g.variants.map(variantView);
  else out.watts = [...new Set(g.variants.map((v) => v.watt))].join(', ');
  return out;
}

function searchProducts(query, limit = 6) {
  const q = String(query || '');
  const nq = norm(q);
  if (!nq) return { matches: [] };
  const words = q.toLowerCase().split(/[^a-z0-9+]+/).filter((w) => w.length > 1);
  const scored = [];

  for (const g of pricedGroups) {
    let s = 0;
    const codeN = norm(g.code);
    const webN = norm(g.web_model);
    if (codeN.length > 3 && nq.includes(codeN)) s += 100;
    if (webN.length > 3 && nq.includes(webN)) s += 100;
    const nameN = norm(g.name);
    if (nameN.length > 2 && nq.includes(nameN)) s += 70;
    for (const a of g.aliases) if (a.length > 3 && nq.includes(a)) { s += 40; break; }
    const nameWords = g.name.toLowerCase().split(/[^a-z0-9+]+/).filter((w) => w.length > 2 && !['light', 'lights', 'the', 'and'].includes(w));
    s += nameWords.filter((w) => words.includes(w)).length * 12;
    const magnetic = /magnet|nano|micro|mini|\btr\b|slim|25mm|16mm|11mm/.test(q.toLowerCase());
    for (const [re, cats] of CATEGORY_HINTS) if (re.test(q.toLowerCase()) && cats.includes(g.category) && !(magnetic && cats.includes('Track / Linear Light'))) s += 15;
    if (s > 0) scored.push([s, g]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const top = scored.length ? scored.filter((x) => x[0] >= scored[0][0] * 0.5) : [];
  const wantDetail = top.length <= 3;
  const matches = top.slice(0, limit).map(([, g]) => summarize(g, wantDetail));

  // website-only products (no price in the list): magnetic track range, wire, etc.
  const pricedWeb = new Set(pricedGroups.map((g) => norm(g.web_model)));
  const extraScored = [];
  for (const p of products) {
    if (pricedWeb.has(norm(p.model))) continue;
    const nm = norm(p.name);
    let sc = 0;
    if (nm.length > 3 && nq.includes(nm)) sc += 50;
    if (norm(p.model).length > 3 && nq.includes(norm(p.model))) sc += 50;
    const hay = (p.name + ' ' + p.category).toLowerCase();
    sc += words.filter((w) => w.length > 2 && !['light', 'lights', 'the', 'and', 'for'].includes(w) && hay.includes(w)).length * 10;
    if (sc >= 10) extraScored.push([sc, { model: p.model, name: p.name, category: p.category, priced: false }]);
  }
  extraScored.sort((a, b) => b[0] - a[0]);
  const extra = extraScored.map((x) => x[1]);
  const res = { matches };
  if (extra.length && matches.length < limit) res.catalogue_only = extra.slice(0, limit - matches.length);
  if (extra.length > (res.catalogue_only || []).length) res.more_catalogue_items = extra.length - (res.catalogue_only || []).length;
  if (res.catalogue_only) res.note = 'catalogue_only items have no price in the list: say the team will confirm the price.';
  return res;
}

function getProductDetails(codeOrName) {
  const found = searchProducts(codeOrName, 1);
  const g = found.matches[0];
  const model = g ? (g.web_model || g.code) : codeOrName;
  const web = webProduct(model) || (found.catalogue_only && webProduct(found.catalogue_only[0].model)) ||
    products.find((p) => norm(p.name) === norm(codeOrName));
  const out = {};
  if (g) {
    const full = pricedGroups.find((x) => x.code === g.code && x.name === g.name);
    out.priced_product = summarize(full, true);
  }
  if (web) {
    out.website_model = web.model;
    out.name = web.name;
    out.category = web.category;
    out.specs = web.specs.map(([k, v]) => `${k}: ${v}`).join(' | ').slice(0, 1400);
    out.photos_available = web.images.length;
  }
  if (!g && !web) out.error = 'No product found. Ask the customer for the product name/code or use search_products.';
  if (!g && web) out.note = 'No price in list: the team will confirm the price.';
  return out;
}

// ---- quotation maths ----
function buildQuotation({ customer, items }) {
  const lines = [];
  const problems = [];
  for (const it of items || []) {
    const v = byVariantId.get(String(it.variant_id));
    const qty = Math.floor(Number(it.quantity));
    if (!v) { problems.push(`Unknown variant_id ${it.variant_id}. Use search_products to get valid variant_id values.`); continue; }
    if (!(qty >= 1) || qty > 100000) { problems.push(`Invalid quantity for ${v.name} ${v.watt}.`); continue; }
    let tier = TIERS.includes(it.tier) ? it.tier : (v.prices.single_piece ? 'single_piece' : Object.keys(v.prices)[0]);
    if (!v.prices[tier]) { problems.push(`${v.name} ${v.watt} has no ${tier} price. Available: ${Object.keys(v.prices).join(', ')}.`); continue; }
    const mrp = v.prices[tier];
    const discountAmt = money((mrp * DISCOUNT) / 100);
    const rate = money(mrp - discountAmt);
    lines.push({
      product: v.name, code: v.code, watt: v.watt, colour: v.colour, tier, tier_label: TIER_LABEL[tier],
      qty, mrp, discount_pct: DISCOUNT, rate, amount: money(rate * qty),
    });
  }
  if (problems.length) return { error: problems.join(' ') };
  if (!lines.length) return { error: 'No items to quote.' };
  const subtotal = money(lines.reduce((s, l) => s + l.mrp * l.qty, 0));
  const grand = money(lines.reduce((s, l) => s + l.amount, 0));
  return { customer, lines, subtotal, total_discount: money(subtotal - grand), grand_total: grand };
}

const CATEGORY_OVERVIEW = [...new Set(variants.map((v) => v.category))].join('; ');

module.exports = { searchProducts, getProductDetails, webProduct, buildQuotation, offer, DISCOUNT, TIER_LABEL, CATEGORY_OVERVIEW, money, products };

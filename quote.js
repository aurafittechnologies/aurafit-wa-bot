// AuraFit quotation: WhatsApp text version + a dependency-free PDF (A4) matching the quotation generator.
const company = require('./company.json');

const inr = (n) => '\u20B9' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const IST = { timeZone: 'Asia/Kolkata' };
const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', ...IST });

function newQuoteMeta() {
  const now = new Date();
  const ymd = now.toLocaleDateString('en-CA', IST).replace(/-/g, ''); // YYYYMMDD in IST
  const seq = String(Math.floor(1000 + Math.random() * 9000));
  const valid = new Date(now.getTime() + (company.quote_validity_days || 30) * 86400000);
  return { number: `AFT/WA/${ymd}/${seq}`, date: fmtDate(now), valid_until: fmtDate(valid) };
}

function inWords(amount) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : ''));
  const three = (n) => (n >= 100 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
  let r = Math.floor(amount);
  const paise = Math.round((amount - r) * 100);
  const parts = [];
  const crore = Math.floor(r / 1e7); r %= 1e7;
  const lakh = Math.floor(r / 1e5); r %= 1e5;
  const th = Math.floor(r / 1e3); r %= 1e3;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (th) parts.push(two(th) + ' Thousand');
  if (r) parts.push(three(r));
  let s = 'Rupees ' + (parts.join(' ') || 'Zero');
  if (paise) s += ' and ' + two(paise) + ' Paise';
  return s + ' Only';
}

// ---------- WhatsApp text quotation ----------
function quoteText(q, meta, cust) {
  const L = [];
  L.push('*QUOTATION* \u2014 AuraFit Technologies');
  L.push(`No: ${meta.number}`);
  L.push(`Date: ${meta.date}  |  Valid till: ${meta.valid_until}`);
  L.push('');
  L.push(`Customer: ${cust.name || 'Customer'}${cust.city ? ', ' + cust.city : ''}`);
  L.push('');
  q.lines.forEach((l, i) => {
    L.push(`${i + 1}. *${l.product}* (${l.code}) ${l.watt}${l.colour ? ' | ' + l.colour : ''}`);
    L.push(`   ${l.tier_label}`);
    L.push(`   ${l.qty} pcs \u00D7 ${inr(l.rate)} = *${inr(l.amount)}*  (MRP ${inr(l.mrp)}, ${l.discount_pct}% off)`);
  });
  L.push('');
  L.push(`MRP total: ${inr(q.subtotal)}`);
  L.push(`Discount: -${inr(q.total_discount)}`);
  L.push(`*GRAND TOTAL: ${inr(q.grand_total)}*`);
  L.push('');
  L.push('_Terms:_');
  company.terms.forEach((t) => L.push('\u2022 ' + t));
  L.push('');
  L.push(`${company.website} | ${company.phone}`);
  return L.join('\n');
}

// ---------- minimal PDF writer (Helvetica, ASCII only) ----------
const W = 595.28, H = 841.89, M = 40;
const GOLD = [0.843, 0.667, 0.227], BLACK = [0.043, 0.047, 0.043], GREY = [0.945, 0.941, 0.933], LINE = [0.89, 0.882, 0.863], INK = [0.1, 0.1, 0.1];

const ascii = (s) => String(s == null ? '' : s)
  .replace(/\u20B9/g, 'Rs.').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u00D7/g, 'x')
  .replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function tw(str, size, bold) { // rough Helvetica width estimate
  let w = 0;
  for (const ch of str) {
    if ('il.,:;!|\'()[]ftjI '.includes(ch)) w += 0.28;
    else if ('mwMW'.includes(ch)) w += 0.8;
    else if (/[A-Z0-9]/.test(ch)) w += ch >= '0' && ch <= '9' ? 0.556 : 0.68;
    else w += 0.54;
  }
  return w * size * (bold ? 1.06 : 1);
}
function wrap(str, width, size, bold) {
  const out = []; let cur = '';
  for (const word of ascii(str).split(' ')) {
    const t = cur ? cur + ' ' + word : word;
    if (tw(t, size, bold) <= width || !cur) cur = t; else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out;
}

class Pdf {
  constructor() { this.pages = []; this.cur = null; this.addPage(); }
  addPage() { this.cur = []; this.pages.push(this.cur); }
  rect(x, y, w, h, fill) { this.cur.push(`${fill.join(' ')} rg ${x.toFixed(2)} ${(H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  line(x1, y, x2, color = LINE, lw = 0.6) { this.cur.push(`${color.join(' ')} RG ${lw} w ${x1.toFixed(2)} ${(H - y).toFixed(2)} m ${x2.toFixed(2)} ${(H - y).toFixed(2)} l S`); }
  text(str, x, y, o = {}, pageIdx) {
    const size = o.size || 9, bold = !!o.bold, s = ascii(str);
    let px = x;
    if (o.align === 'right') px = x - tw(s, size, bold); else if (o.align === 'center') px = x - tw(s, size, bold) / 2;
    const ops = `BT ${(o.color || INK).join(' ')} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${px.toFixed(2)} ${(H - y).toFixed(2)} Td (${esc(s)}) Tj ET`;
    (pageIdx == null ? this.cur : this.pages[pageIdx]).push(ops);
  }
  toBuffer() {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add(''); // pages placeholder (object 2)
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const p of this.pages) {
      const content = p.join('\n');
      const cId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      const pId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cId} 0 R >>`);
      kids.push(`${pId} 0 R`);
    }
    objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, 'latin1');
  }
}

function quotePdf(q, meta, cust) {
  const pdf = new Pdf();
  const cols = [28, 193, 36, 62, 42, 66, 88]; // Sr, Description, Qty, MRP, Disc, Rate, Amount (= 515)
  const xs = []; cols.reduce((x, w) => { xs.push(x); return x + w; }, M);
  const BOTTOM = H - 95;

  const header = () => {
    pdf.rect(0, 0, W, 74, BLACK); pdf.rect(0, 74, W, 3, GOLD);
    pdf.text('AURAFIT TECHNOLOGIES', M, 36, { size: 19, bold: true, color: GOLD });
    pdf.text(company.tagline.toUpperCase(), M, 54, { size: 8, color: [0.85, 0.85, 0.85] });
    pdf.text('QUOTATION', W - M, 42, { size: 20, bold: true, color: GOLD, align: 'right' });
  };
  const tableHead = (y) => {
    pdf.rect(M, y, 515, 22, BLACK);
    const t = ['SR', 'PRODUCT / DESCRIPTION', 'QTY', 'MRP/PC (Rs.)', 'DISC %', 'RATE/PC (Rs.)', 'AMOUNT (Rs.)'];
    t.forEach((h, i) => {
      const al = i < 2 ? 'left' : 'right';
      pdf.text(h, al === 'left' ? xs[i] + 4 : xs[i] + cols[i] - 4, y + 14.5, { size: 7.5, bold: true, color: GOLD, align: al });
    });
    return y + 22;
  };

  header();
  // meta + customer
  let y = 96;
  pdf.text('CUSTOMER DETAILS', M, y, { size: 8, bold: true, color: [0.61, 0.46, 0.12] });
  pdf.text(ascii(cust.name) || 'Customer', M, y + 16, { size: 12, bold: true });
  let cy = y + 30;
  if (cust.city) { pdf.text(cust.city, M, cy, { size: 9 }); cy += 12; }
  if (cust.phone) { pdf.text('WhatsApp: +' + String(cust.phone).replace(/^\+/, ''), M, cy, { size: 9 }); cy += 12; }
  const mx = W - M - 215;
  [['Quotation No.', meta.number], ['Quotation Date', meta.date], ['Valid Upto', meta.valid_until]].forEach(([k, v], i) => {
    pdf.text(k, mx, y + i * 15, { size: 8.5, color: [0.4, 0.4, 0.4] });
    pdf.text(': ' + v, mx + 80, y + i * 15, { size: 9, bold: true });
  });
  y = Math.max(cy, y + 50) + 8;
  y = tableHead(y);

  q.lines.forEach((l, i) => {
    const d1 = wrap(`${l.product} (${l.code})`, cols[1] - 8, 9, true);
    const d2 = wrap(`${l.watt}${l.colour ? ' | ' + l.colour : ''} | ${l.tier_label}`, cols[1] - 8, 7.5, false);
    const h = 8 + (d1.length * 11) + (d2.length * 9.5);
    if (y + h > BOTTOM - 20) { pdf.addPage(); header(); y = tableHead(96); }
    if (i % 2 === 1) pdf.rect(M, y, 515, h, [0.985, 0.98, 0.972]);
    pdf.text(String(i + 1), xs[0] + cols[0] - 4, y + 14, { size: 9, align: 'right' });
    let ty = y + 14;
    d1.forEach((s) => { pdf.text(s, xs[1] + 4, ty, { size: 9, bold: true }); ty += 11; });
    d2.forEach((s) => { pdf.text(s, xs[1] + 4, ty - 1, { size: 7.5, color: [0.35, 0.35, 0.35] }); ty += 9.5; });
    pdf.text(String(l.qty), xs[2] + cols[2] - 4, y + 14, { size: 9, align: 'right' });
    pdf.text(num(l.mrp), xs[3] + cols[3] - 4, y + 14, { size: 9, align: 'right' });
    pdf.text(l.discount_pct + '%', xs[4] + cols[4] - 4, y + 14, { size: 9, align: 'right' });
    pdf.text(num(l.rate), xs[5] + cols[5] - 4, y + 14, { size: 9, align: 'right' });
    pdf.text(num(l.amount), xs[6] + cols[6] - 4, y + 14, { size: 9, bold: true, align: 'right' });
    pdf.line(M, y + h, M + 515);
    y += h;
  });

  // totals + words + terms (keep together; new page if needed)
  const termLines = company.terms.flatMap((t, i) => wrap(`${i + 1}. ${t}`, 515, 8, false));
  const need = 90 + termLines.length * 11 + 30;
  if (y + need > BOTTOM) { pdf.addPage(); header(); y = 96; }
  y += 14;
  const tx = W - M - 230;
  [['Total MRP', num(q.subtotal), false], ['Total Discount', '- ' + num(q.total_discount), false]].forEach(([k, v]) => {
    pdf.text(k, tx, y, { size: 9 }); pdf.text('Rs. ' + v, W - M - 4, y, { size: 9, align: 'right' }); y += 15;
  });
  pdf.rect(tx - 6, y - 11, 236, 22, BLACK);
  pdf.text('GRAND TOTAL', tx, y + 4, { size: 10, bold: true, color: GOLD });
  pdf.text('Rs. ' + num(q.grand_total), W - M - 4, y + 4, { size: 11, bold: true, color: GOLD, align: 'right' });
  y += 30;
  wrap('Amount in words: ' + inWords(q.grand_total), 515, 9, true).forEach((s) => { pdf.text(s, M, y, { size: 9, bold: true }); y += 12; });
  y += 8;
  pdf.text('TERMS & CONDITIONS', M, y, { size: 8.5, bold: true, color: [0.61, 0.46, 0.12] }); y += 13;
  termLines.forEach((s) => { pdf.text(s, M, y, { size: 8 }); y += 11; });
  y += 6;
  pdf.text('Quotation issued through the AuraFit WhatsApp assistant. Order is confirmed only after the AuraFit team confirms it.', M, y, { size: 7.5, color: [0.4, 0.4, 0.4] });

  // footer on every page
  const n = pdf.pages.length;
  pdf.pages.forEach((_, i) => {
    pdf.pages[i].push(`${GOLD.join(' ')} RG 1 w ${M} ${H - (H - 70)} m ${W - M} ${H - (H - 70)} l S`);
    pdf.text(`${company.website}   |   ${company.instagram}   |   +91 ${company.phone}   |   ${company.email}`, W / 2, H - 52, { size: 8, align: 'center' }, i);
    pdf.text('AURAFIT TECHNOLOGIES', W / 2, H - 38, { size: 8, bold: true, color: [0.61, 0.46, 0.12], align: 'center' }, i);
    if (n > 1) pdf.text(`Page ${i + 1} of ${n}`, W - M, H - 38, { size: 8, align: 'right', color: [0.4, 0.4, 0.4] }, i);
  });
  return pdf.toBuffer();
}

module.exports = { newQuoteMeta, quoteText, quotePdf, inr, inWords };

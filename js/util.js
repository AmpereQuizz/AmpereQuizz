// Petits utilitaires partagés : texte, dates, nombres, hasard, HTML.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function slugify(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sample(arr, n) { return shuffle(arr).slice(0, n); }

// ---------- Comparaison tolérante du texte ----------

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function romanToInt(s) {
  if (!/^(m{0,3})(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/.test(s) || !s) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]], next = ROMAN[s[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total;
}

const STOP = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'the', 'a', 'an']);

// Ramène une réponse à une forme comparable : minuscules, sans accents,
// sans ponctuation ni articles, chiffres romains et « 1er » convertis.
export function normalize(s) {
  let t = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss');
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  const words = t.split(' ').filter(Boolean).map(w => {
    if (w === 'ier' || w === '1er' || w === 'premier' || w === 'premiere' || w === '1re' || w === '1ere') return '1';
    const r = w.length <= 6 ? romanToInt(w) : null;
    return r ? String(r) : w;
  });
  const kept = words.filter(w => !STOP.has(w));
  return (kept.length ? kept : words).join(' ');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Résultat : 'exact', 'proche' (faute de frappe tolérée) ou false.
export function matchText(input, accepted) {
  const a = normalize(input);
  if (!a) return false;
  let best = false;
  for (const exp of accepted) {
    const b = normalize(exp);
    if (!b) continue;
    if (a === b) return 'exact';
    // Les nombres (Louis 14 vs Louis 13) doivent être exacts.
    const digitsA = a.match(/\d+/g)?.join(',') ?? '', digitsB = b.match(/\d+/g)?.join(',') ?? '';
    if (digitsA !== digitsB) continue;
    const allowed = b.length <= 3 ? 0 : b.length <= 6 ? 1 : b.length <= 12 ? 2 : 3;
    if (levenshtein(a, b) <= allowed) best = 'proche';
  }
  return best;
}

// ---------- Dates ----------

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Accepte "1515", "1515-09", "1515-09-13", "-52" (av. J.-C.).
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const m = String(v).trim().match(/^(-?\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const y = +m[1], mo = m[2] ? +m[2] : null, d = m[3] ? +m[3] : null;
  return { y, m: mo, d, key: y * 10000 + (mo || 0) * 100 + (d || 0) };
}

export function formatDate(v) {
  const p = parseDate(v);
  if (!p) return String(v ?? '');
  const year = p.y < 0 ? `${-p.y} av. J.-C.` : String(p.y);
  if (p.d && p.m) return `${p.d === 1 ? '1er' : p.d} ${MOIS[p.m - 1]} ${year}`;
  if (p.m) return `${MOIS[p.m - 1]} ${year}`;
  return year;
}

// Lit une date tapée par l'utilisateur : "1515", "13/09/1515", "52 av jc"…
export function parseUserDate(s) {
  const t = String(s ?? '').trim().toLowerCase();
  if (!t) return null;
  const bc = /av/.test(t) ? -1 : 1;
  let m = t.match(/^(\d{1,2})[\/. -](\d{1,2})[\/. -](-?\d{1,4})/);
  if (m) return { y: bc * +m[3], m: +m[2], d: +m[1] };
  m = t.match(/^(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(-?\d{1,4})/);
  if (m) {
    const mi = MOIS.findIndex(x => normalize(x) === normalize(m[2]));
    if (mi >= 0) return { y: bc * +m[3], m: mi + 1, d: +m[1] };
  }
  const iso = parseDate(t.replace(/\s/g, ''));
  if (iso) return iso;
  m = t.match(/-?\d{1,4}/);
  if (m) return { y: bc * Math.abs(+m[0]) * (m[0].startsWith('-') ? -1 : 1), m: null, d: null };
  return null;
}

// ---------- Nombres ----------

export function parseNumber(s) {
  if (typeof s === 'number') return s;
  const t = String(s ?? '').replace(/\s| | /g, '').replace(',', '.');
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  return parseFloat(t);
}

export function formatNumber(n) {
  return typeof n === 'number' ? n.toLocaleString('fr-FR') : String(n ?? '');
}

// ---------- Divers ----------

export function formatWhen(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, kind = '') {
  const el = h(`<div class="toast ${kind}">${esc(msg)}</div>`);
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}

// Chargement des listes (dépôt + brouillons locaux) et lecture des cellules.
import { esc, slugify, formatDate, formatNumber, parseDate, safeUrl } from './util.js';
import { drafts } from './store.js';
import { currentUser, myLists, getMyList, getChallenge, publicLists } from './cloud.js';

export const TYPES = {
  text: 'Texte',
  number: 'Nombre',
  date: 'Date',
  image: 'Image',
  audio: 'Son',
};

let indexCache = null;
const listCache = new Map();
// Listes publiques enregistrées en ligne par un administrateur (elles remplacent celles du dépôt de même identifiant).
let publicCache = null;

async function loadPublic() {
  if (!publicCache) {
    publicCache = new Map();
    for (const p of await publicLists()) publicCache.set(p.id, p);
  }
  return publicCache;
}

export function invalidateLists() {
  indexCache = null;
  publicCache = null;
  listCache.clear();
}

export async function publicData(id) {
  const p = (await loadPublic()).get(id);
  return p && !p.hidden ? structuredClone(p.data) : null;
}

export async function loadIndex() {
  if (!indexCache) {
    let remote = [];
    try {
      const res = await fetch('lists/index.json', { cache: 'no-cache' });
      if (res.ok) remote = (await res.json()).lists || [];
    } catch (e) { console.warn('index.json introuvable', e); }
    const pub = await loadPublic();
    remote = remote.filter(l => !pub.has(l.id));
    for (const p of pub.values()) {
      if (p.hidden || !p.data) continue;
      const img = (p.data.columns || []).find(c => c.type === 'image');
      const first = img && (p.data.rows || []).map(r => r[img.key]).find(v => v && (typeof v === 'string' || v.src));
      const src = typeof first === 'string' ? first : first?.src;
      remote.push({
        id: p.id, title: p.title, description: p.data.description || '', count: (p.data.rows || []).length,
        columns: (p.data.columns || []).map(c => c.label), online: true,
        ...(src && !src.startsWith('data:') ? { cover: src } : {}),
      });
    }
    remote.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    indexCache = remote;
  }
  const remoteIds = new Set(indexCache.map(l => l.id));
  const clean = d => d._publishedAt && !d._dirty && remoteIds.has(d.id);
  // Brouillon enregistré sur le site et publié depuis un moment : plus besoin de la copie locale.
  for (const d of Object.values(drafts.all())) {
    if (clean(d) && Date.now() - d._publishedAt > 5 * 60000) drafts.remove(d._draftId);
  }
  const local = Object.values(drafts.all()).filter(d => !clean(d)).map(d => ({
    id: 'brouillon:' + d._draftId,
    title: d.title || 'Sans titre',
    description: d.description || '',
    count: (d.rows || []).length,
    draft: true,
  }));
  let mine = [];
  if (currentUser()) {
    try {
      mine = (await myLists()).map(l => ({
        id: 'perso:' + l.id, title: l.title, description: l.data?.description || '',
        count: (l.data?.rows || []).length, mine: true,
      }));
    } catch (e) { console.warn('Listes perso indisponibles', e); }
  }
  return [...indexCache, ...mine, ...local];
}

export async function loadList(id) {
  if (id.startsWith('brouillon:')) {
    const d = drafts.get(id.slice(10));
    if (!d) throw new Error('Brouillon introuvable');
    return prepare(structuredClone(d), id, 'lists/');
  }
  if (id.startsWith('perso:')) {
    const l = await getMyList(id.slice(6));
    if (!l) throw new Error('Liste introuvable (êtes-vous connecté au bon compte ?)');
    return prepare(structuredClone(l.data), id, 'lists/');
  }
  if (id.startsWith('defi:')) {
    const c = await getChallenge(id.slice(5));
    if (!c?.list_snapshot) throw new Error('Défi introuvable');
    return prepare(structuredClone(c.list_snapshot), id, 'lists/');
  }
  if (!listCache.has(id)) {
    const pub = (await loadPublic()).get(id);
    if (pub?.hidden) throw new Error(`Liste « ${id} » retirée`);
    if (pub?.data) {
      listCache.set(id, prepare(structuredClone(pub.data), id, 'lists/'));
      return listCache.get(id);
    }
    const res = await fetch(`lists/${encodeURIComponent(id)}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Liste « ${id} » introuvable`);
    listCache.set(id, prepare(await res.json(), id, 'lists/'));
  }
  return listCache.get(id);
}

// Complète une liste brute : identifiants de colonnes et de lignes.
export function prepare(list, id, base) {
  list.id = id;
  list._base = base;
  list.columns = (list.columns || []).map(c => ({ type: 'text', ...c, key: c.key || slugify(c.label) }));
  const firstText = list.columns.find(c => c.type === 'text');
  const used = new Set();
  list.rows = (list.rows || []).map((r, i) => {
    let rid = r.id || (firstText ? slugify(textOf(r[firstText.key])) : '') || 'l' + i;
    while (used.has(rid)) rid += '-' + i;
    used.add(rid);
    return { ...r, _id: rid, tags: r.tags || [] };
  });
  return list;
}

export function textOf(v) {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export function isEmpty(v) {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0 || v.every(x => x === '' || x == null);
  return false;
}

// Texte affichable d'une cellule (pour les colonnes non média).
export function display(col, v) {
  if (isEmpty(v)) return '';
  switch (col.type) {
    case 'number': return formatNumber(typeof v === 'number' ? v : Number(v)) + (col.unit ? ' ' + col.unit : '');
    case 'date': return formatDate(v);
    case 'image':
    case 'audio': return '';
    default: return String(textOf(v));
  }
}

// Valeur de tri / comparaison (nombres et dates).
export function sortKey(col, v) {
  if (col.type === 'date') return parseDate(v)?.key ?? null;
  if (col.type === 'number') return typeof v === 'number' ? v : (v === '' || v == null ? null : Number(v));
  return null;
}

export function mediaInfo(list, v) {
  if (isEmpty(v)) return null;
  const o = typeof v === 'string' ? { src: v } : { ...v };
  o.src = safeUrl(o.src);
  o.source = safeUrl(o.source);
  if (o.src && !/^(https?:|data:|blob:)/.test(o.src)) o.src = (list._base || '') + o.src;
  return o;
}

export function mediaHTML(list, col, v, cls = '') {
  const m = mediaInfo(list, v);
  if (!m) return '';
  if (!m.src) {
    return `<div class="media-missing ${cls}">Image pas encore récupérée${m.wikipedia ? ` (Wikipédia : ${esc([].concat(m.wikipedia)[0])})` : ''}</div>`;
  }
  const credit = m.credit || m.license
    ? `<figcaption>${m.credit ? esc(m.credit) : ''}${m.license ? ` · ${esc(m.license)}` : ''}${m.source ? ` · <a href="${esc(m.source)}" target="_blank" rel="noopener">source</a>` : ''}</figcaption>`
    : '';
  if (col.type === 'audio') return `<figure class="media ${cls}"><audio controls preload="none" src="${esc(m.src)}"></audio>${credit}</figure>`;
  return `<figure class="media ${cls}"><img src="${esc(m.src)}" alt="${esc(col.label)}" loading="lazy">${credit}</figure>`;
}

// Fiche complète d'une ligne.
export function cardHTML(list, row, highlight = []) {
  const items = list.columns.map(col => {
    const v = row[col.key];
    if (isEmpty(v)) return '';
    const hl = highlight.includes(col.key) ? ' hl' : '';
    if (col.type === 'image' || col.type === 'audio') {
      return `<div class="card-field media-field${hl}"><span class="lbl">${esc(col.label)}</span>${mediaHTML(list, col, v)}</div>`;
    }
    const alt = Array.isArray(v) && v.length > 1 ? `<span class="alt">aussi : ${v.slice(1).map(esc).join(', ')}</span>` : '';
    return `<div class="card-field${hl}"><span class="lbl">${esc(col.label)}</span><span class="val">${esc(display(col, v))}</span>${alt}</div>`;
  }).join('');
  const tags = row.tags?.length ? `<div class="tags">${row.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : '';
  return `<div class="card">${items}${tags}</div>`;
}

// Colonnes texte pouvant servir de filtre (peu de valeurs distinctes, répétées).
export function filterColumns(list) {
  return list.columns.filter(c => {
    if (c.filter === false) return false;
    if (c.type !== 'text' && !c.filter) return false;
    const vals = new Set(list.rows.map(r => textOf(r[c.key])).filter(Boolean));
    if (c.filter) return vals.size > 0;
    return vals.size >= 2 && vals.size <= 25 && vals.size < list.rows.length * 0.7;
  });
}

export function allTags(list) {
  const s = new Set();
  list.rows.forEach(r => r.tags.forEach(t => s.add(t)));
  return [...s].sort((a, b) => a.localeCompare(b, 'fr'));
}

export function applyFilters(list, filters = {}) {
  return list.rows.filter(r => {
    if (filters.tags?.length && !filters.tags.some(t => r.tags.includes(t))) return false;
    for (const [key, vals] of Object.entries(filters.values || {})) {
      if (vals?.length && !vals.includes(String(textOf(r[key])))) return false;
    }
    return true;
  });
}

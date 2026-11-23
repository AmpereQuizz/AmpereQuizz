// Éditeur de listes : brouillons locaux, export (.zip / .json), publication GitHub.
import { $, $$, esc, slugify, toast } from './util.js';
import { loadIndex, TYPES, textOf, mediaInfo, isEmpty } from './data.js';
import { drafts, settings } from './store.js';

const newDraftId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ======================= Accueil de l'éditeur =======================

export async function renderEditorHome(el) {
  const all = Object.values(drafts.all());
  const index = (await loadIndex()).filter(l => !l.draft);
  el.innerHTML = `<section>
    <div class="page-head"><h1>Éditeur de listes</h1>
      <p class="muted">Les brouillons restent dans ce navigateur. On peut les jouer tout de suite, puis les télécharger ou les publier dans le dépôt GitHub pour les rendre permanents.</p></div>
    <div class="actions">
      <button class="btn primary" id="new">+ Nouvelle liste</button>
      <label class="btn">Importer un .json<input type="file" accept=".json,application/json" id="import" hidden></label>
    </div>
    ${index.length ? `<div class="panel"><h2>Modifier une liste du site</h2>
      <p class="hint">Crée un brouillon à partir d’une copie ; la liste publiée n’est changée qu’à la publication.</p>
      <div class="chips">${index.map(l => `<button class="chip" data-copy="${esc(l.id)}">${esc(l.title)}</button>`).join('')}</div></div>` : ''}
    <h2>Mes brouillons</h2>
    ${all.length ? `<div class="list-grid">${all.map(d => `
      <a class="list-card" href="#/editeur/${d._draftId}">
        <h3>${esc(d.title || 'Sans titre')}</h3>
        <p class="small muted">${(d.rows || []).length} fiches · ${(d.columns || []).length} colonnes</p>
      </a>`).join('')}</div>` : '<div class="empty">Aucun brouillon.</div>'}
  </section>`;

  $('#new', el).onclick = () => {
    const d = {
      _draftId: newDraftId(), id: '', title: '', description: '',
      columns: [{ key: 'nom', label: 'Nom', type: 'text' }, { key: 'image', label: 'Image', type: 'image' }],
      rows: [],
    };
    drafts.save(d);
    location.hash = '#/editeur/' + d._draftId;
  };
  $('#import', el).onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.columns) || !Array.isArray(data.rows)) throw new Error('il faut « columns » et « rows »');
      data._draftId = newDraftId();
      data.id ||= slugify(data.title || file.name.replace(/\.json$/, ''));
      drafts.save(data);
      location.hash = '#/editeur/' + data._draftId;
    } catch (err) { toast('Fichier invalide : ' + err.message, 'err'); }
  };
  $$('[data-copy]', el).forEach(b => b.onclick = async () => {
    const res = await fetch(`lists/${encodeURIComponent(b.dataset.copy)}.json`, { cache: 'no-cache' });
    const data = await res.json();
    data.id ||= b.dataset.copy;
    data._draftId = newDraftId();
    drafts.save(data);
    location.hash = '#/editeur/' + data._draftId;
  });
}

// ======================= Édition d'un brouillon =======================

export function renderEditor(el, draftId) {
  const d = drafts.get(draftId);
  if (!d) { location.hash = '#/editeur'; return; }
  d.columns ||= [];
  d.rows ||= [];
  let saveTimer = null;
  const save = (now = false) => {
    clearTimeout(saveTimer);
    const run = () => {
      if (!drafts.save(d)) toast('Stockage du navigateur plein : exportez la liste ou réduisez les images', 'err');
      const s = $('#saved', el);
      if (s) s.textContent = 'Enregistré dans ce navigateur';
    };
    now ? run() : (saveTimer = setTimeout(run, 400));
  };

  function render() {
    el.innerHTML = `<section class="editor">
      <div class="page-head">
        <a href="#/editeur" class="back">← Brouillons</a>
        <h1>${esc(d.title || 'Nouvelle liste')}</h1>
        <p class="small muted" id="saved"></p>
      </div>

      <div class="panel grid2">
        <label>Titre<input data-meta="title" value="${esc(d.title)}" placeholder="ex. Capitales d’Europe"></label>
        <label>Identifiant (nom du fichier)<input data-meta="id" value="${esc(d.id)}" placeholder="capitales-europe"></label>
        <label class="span2">Description<input data-meta="description" value="${esc(d.description)}"></label>
      </div>

      <div class="panel">
        <h2>Colonnes</h2>
        <div class="table-wrap"><table class="ed-cols">
          <thead><tr><th>Nom</th><th>Type</th><th>Unité / tolérance</th><th></th></tr></thead>
          <tbody>${d.columns.map((c, i) => `<tr data-ci="${i}">
            <td><input data-col="label" value="${esc(c.label)}"></td>
            <td><select data-col="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
            <td>${c.type === 'number' ? `<input data-col="unit" value="${esc(c.unit || '')}" placeholder="unité" class="w-s">
                  <input data-col="tolerance" value="${esc(c.tolerance ?? '')}" placeholder="tolérance (2 ou 10%)" class="w-m">`
                : c.type === 'date' ? `<input data-col="tolerance" value="${esc(c.tolerance ?? '')}" placeholder="tolérance en années" class="w-m">` : ''}</td>
            <td class="nowrap"><button class="icon-btn" data-colmove="-1" title="Monter">↑</button><button class="icon-btn" data-colmove="1" title="Descendre">↓</button><button class="icon-btn" data-coldel title="Supprimer">✕</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
        <button class="btn small" id="add-col">+ Colonne</button>
      </div>

      <div class="panel">
        <h2>Fiches <span class="muted small">(${d.rows.length})</span></h2>
        <p class="hint">Plusieurs réponses acceptées : séparez-les par « | » (ex. « Rouge-gorge | Rougegorge »). Dates : 1515 ou 1515-09-13. Images : fichier, adresse web, ou <code>wikipedia:Titre de l’article</code> (la photo et son crédit sont récupérés à la publication).</p>
        <div class="table-wrap"><table class="ed-rows">
          <thead><tr><th>#</th>${d.columns.map(c => `<th>${esc(c.label)}</th>`).join('')}<th>Étiquettes</th><th></th></tr></thead>
          <tbody>${d.rows.map((r, i) => rowHTML(r, i)).join('')}</tbody>
        </table></div>
        <button class="btn small" id="add-row">+ Fiche</button>
      </div>

      <div class="panel">
        <h2>Utiliser la liste</h2>
        <div class="actions">
          <a class="btn primary" href="#/liste/brouillon:${d._draftId}">▶ S’entraîner avec ce brouillon</a>
          <button class="btn" id="dl-zip">Télécharger (.zip avec images)</button>
          <button class="btn" id="dl-json">Télécharger le .json seul</button>
          <button class="btn ghost" id="del">Supprimer le brouillon</button>
        </div>
        <details class="gh"><summary>Publier directement dans le dépôt GitHub</summary>
          ${githubForm()}
        </details>
      </div>
    </section>`;
    bind();
  }

  function cellHTML(c, v) {
    if (c.type === 'image' || c.type === 'audio') {
      const m = mediaInfo({ _base: 'lists/' }, v);
      const shown = !v ? '' : typeof v === 'string' ? (v.startsWith('data:') ? '(fichier importé)' : v)
        : v.wikipedia ? 'wikipedia:' + v.wikipedia : (v.src?.startsWith('data:') ? '(fichier importé)' : v.src || '');
      const preview = m?.src ? (c.type === 'image' ? `<img src="${esc(m.src)}" alt="">` : '🔊') : (v?.wikipedia ? '🌐' : '');
      return `<div class="media-cell"><span class="pv">${preview}</span>
        <input data-media value="${esc(shown)}" placeholder="adresse ou wikipedia:…">
        <label class="icon-btn" title="Choisir un fichier">📁<input type="file" accept="${c.type === 'image' ? 'image/*' : 'audio/*'}" hidden data-file></label></div>`;
    }
    const val = Array.isArray(v) ? v.join(' | ') : (v ?? '');
    return `<input data-cell value="${esc(val)}" ${c.type === 'number' ? 'inputmode="decimal"' : ''} placeholder="${c.type === 'date' ? 'AAAA-MM-JJ' : ''}">`;
  }

  function rowHTML(r, i) {
    return `<tr data-ri="${i}"><td class="muted small">${i + 1}</td>
      ${d.columns.map(c => `<td data-key="${esc(c.key)}">${cellHTML(c, r[c.key])}</td>`).join('')}
      <td><input data-tags value="${esc((r.tags || []).join(', '))}" placeholder="a, b"></td>
      <td class="nowrap"><button class="icon-btn" data-rowdel title="Supprimer la fiche">✕</button></td></tr>`;
  }

  function parseCell(c, s) {
    s = s.trim();
    if (!s) return undefined;
    if (c.type === 'number') {
      const n = Number(s.replace(',', '.').replace(/\s/g, ''));
      return Number.isFinite(n) ? n : s;
    }
    if (c.type === 'text' && s.includes('|')) return s.split('|').map(x => x.trim()).filter(Boolean);
    return s;
  }

  function bind() {
    $$('[data-meta]', el).forEach(i => i.oninput = () => {
      d[i.dataset.meta] = i.value;
      if (i.dataset.meta === 'title') {
        $('h1', el).textContent = i.value || 'Nouvelle liste';
        const idIn = $('[data-meta="id"]', el);
        if (!idIn.dataset.touched) { d.id = slugify(i.value); idIn.value = d.id; }
      }
      if (i.dataset.meta === 'id') { i.dataset.touched = '1'; d.id = slugify(i.value) || i.value; }
      save();
    });
    if (d.id && d.id !== slugify(d.title)) $('[data-meta="id"]', el).dataset.touched = '1';

    $$('.ed-cols [data-col]', el).forEach(i => {
      const ci = +i.closest('tr').dataset.ci;
      const evt = i.tagName === 'SELECT' ? 'change' : 'input';
      i.addEventListener(evt, () => {
        const c = d.columns[ci];
        const f = i.dataset.col;
        if (f === 'tolerance') {
          const t = i.value.trim();
          if (!t) delete c.tolerance; else c.tolerance = t.endsWith('%') ? t : Number(t.replace(',', '.'));
        } else if (f === 'unit') { if (i.value) c.unit = i.value; else delete c.unit; }
        else c[f] = i.value;
        save();
        if (f === 'type') render();
        if (f === 'label') $$('.ed-rows thead th', el)[ci + 1].textContent = i.value;
      });
    });
    $$('[data-coldel]', el).forEach(b => b.onclick = () => {
      const ci = +b.closest('tr').dataset.ci;
      if (!b.dataset.confirm) { b.dataset.confirm = 1; b.textContent = '?'; b.title = 'Cliquer encore pour supprimer'; return; }
      const key = d.columns[ci].key;
      d.columns.splice(ci, 1);
      d.rows.forEach(r => delete r[key]);
      save(true); render();
    });
    $$('[data-colmove]', el).forEach(b => b.onclick = () => {
      const ci = +b.closest('tr').dataset.ci, to = ci + +b.dataset.colmove;
      if (to < 0 || to >= d.columns.length) return;
      [d.columns[ci], d.columns[to]] = [d.columns[to], d.columns[ci]];
      save(true); render();
    });
    $('#add-col', el).onclick = () => {
      let n = d.columns.length + 1, key = 'colonne-' + n;
      while (d.columns.some(c => c.key === key)) key = 'colonne-' + ++n;
      d.columns.push({ key, label: 'Colonne ' + n, type: 'text' });
      save(true); render();
      $$('.ed-cols [data-col="label"]', el).at(-1).select();
    };
    // Une clé lisible quand le nom d'une colonne vide est renommé.
    $$('.ed-cols [data-col="label"]', el).forEach(i => i.addEventListener('change', () => {
      const ci = +i.closest('tr').dataset.ci;
      const c = d.columns[ci];
      const fresh = slugify(i.value);
      if (fresh && c.key !== fresh && d.rows.every(r => isEmpty(r[c.key])) && !d.columns.some(x => x.key === fresh)) {
        c.key = fresh; save(true); render();
      }
    }));

    const rowOf = node => d.rows[+node.closest('tr').dataset.ri];
    const colOf = node => d.columns.find(c => c.key === node.closest('td').dataset.key);
    $$('[data-cell]', el).forEach(i => i.oninput = () => {
      const r = rowOf(i), c = colOf(i);
      const v = parseCell(c, i.value);
      if (v === undefined) delete r[c.key]; else r[c.key] = v;
      save();
    });
    $$('[data-tags]', el).forEach(i => i.oninput = () => {
      const r = rowOf(i);
      r.tags = i.value.split(',').map(t => t.trim()).filter(Boolean);
      if (!r.tags.length) delete r.tags;
      save();
    });
    $$('[data-media]', el).forEach(i => i.onchange = () => {
      const r = rowOf(i), c = colOf(i);
      const s = i.value.trim();
      const prev = r[c.key];
      if (!s) delete r[c.key];
      else if (s === '(fichier importé)') return;
      else if (/^wikipedia:/i.test(s)) r[c.key] = { wikipedia: s.slice(10).trim() };
      else if (prev && typeof prev === 'object' && !prev.wikipedia) r[c.key] = { ...prev, src: s };
      else r[c.key] = s;
      save(true);
      i.closest('td').innerHTML = cellHTML(c, r[c.key]);
      bind();
    });
    $$('[data-file]', el).forEach(i => i.onchange = async () => {
      const file = i.files[0];
      if (!file) return;
      const r = rowOf(i), c = colOf(i);
      const td = i.closest('td');
      try {
        r[c.key] = c.type === 'image' ? await resizeImage(file) : await readDataURL(file);
        if (c.type === 'audio' && file.size > 1.5e6) toast('Son volumineux : le stockage du navigateur risque d’être plein', 'err');
      } catch (e) { toast('Fichier illisible', 'err'); return; }
      save(true);
      td.innerHTML = cellHTML(c, r[c.key]);
      bind();
    });
    $$('[data-rowdel]', el).forEach(b => b.onclick = () => {
      d.rows.splice(+b.closest('tr').dataset.ri, 1);
      save(true); render();
    });
    $('#add-row', el).onclick = () => {
      d.rows.push({});
      save(true); render();
      $$('.ed-rows tbody tr', el).at(-1)?.querySelector('input')?.focus();
    };
    $('#dl-json', el).onclick = async () => {
      const { json } = await exportList(d, false);
      download(new Blob([json], { type: 'application/json' }), `${fileId(d)}.json`);
    };
    $('#dl-zip', el).onclick = async () => {
      const { json, files } = await exportList(d, true);
      const zip = makeZip([{ name: `${fileId(d)}.json`, data: new TextEncoder().encode(json) }, ...files]);
      download(new Blob([zip], { type: 'application/zip' }), `${fileId(d)}.zip`);
    };
    $('#del', el).onclick = e => {
      const b = e.currentTarget;
      if (!b.dataset.confirm) { b.dataset.confirm = 1; b.textContent = 'Cliquer encore pour supprimer'; return; }
      drafts.remove(d._draftId);
      location.hash = '#/editeur';
    };
    bindGithub();
  }

  function githubForm() {
    const s = settings.get();
    const guess = guessRepo();
    return `<p class="hint">Il faut un jeton GitHub « fine-grained » avec l’autorisation <b>Contents : Read and write</b> sur le dépôt. Le site est reconstruit automatiquement une à deux minutes après.</p>
      <div class="grid2">
        <label>Dépôt (propriétaire/nom)<input id="gh-repo" value="${esc(s.ghRepo || guess)}" placeholder="gladuro/quizz"></label>
        <label>Branche (vide = par défaut)<input id="gh-branch" value="${esc(s.ghBranch || '')}"></label>
        <label class="span2">Jeton<input id="gh-token" type="password" value="${esc(s.ghToken || '')}" autocomplete="off"></label>
        <label class="check span2"><input type="checkbox" id="gh-remember" ${s.ghToken ? 'checked' : ''}> Mémoriser le jeton dans ce navigateur</label>
      </div>
      <div class="actions"><button class="btn primary" id="gh-push">Publier</button></div>
      <pre class="log" id="gh-log" hidden></pre>`;
  }

  function bindGithub() {
    $('#gh-push', el).onclick = async () => {
      const repo = $('#gh-repo', el).value.trim(), branch = $('#gh-branch', el).value.trim(), token = $('#gh-token', el).value.trim();
      settings.set({ ghRepo: repo, ghBranch: branch, ghToken: $('#gh-remember', el).checked ? token : '' });
      const log = $('#gh-log', el);
      log.hidden = false;
      log.textContent = '';
      const say = m => { log.textContent += m + '\n'; };
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) { say('Indiquez le dépôt et le jeton.'); return; }
      if (!d.title || !fileId(d)) { say('Donnez d’abord un titre à la liste.'); return; }
      const btn = $('#gh-push', el);
      btn.disabled = true;
      try {
        const { json, files } = await exportList(d, true);
        const all = [...files.map(f => ({ path: 'lists/' + f.name, data: f.data })), { path: `lists/${fileId(d)}.json`, data: new TextEncoder().encode(json) }];
        for (const f of all) {
          say('Envoi de ' + f.path + '…');
          await githubPut(repo, branch, token, f.path, f.data, `Liste « ${d.title} » : ${f.path.split('/').pop()}`);
        }
        say('Terminé. Le site sera à jour dans une à deux minutes.');
      } catch (e) { say('Erreur : ' + e.message); }
      btn.disabled = false;
    };
  }

  render();
}

const fileId = d => slugify(d.id || d.title);

function guessRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!m) return '';
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return seg ? `${m[1]}/${seg}` : `${m[1]}/${m[1]}.github.io`;
}

// Transforme le brouillon en JSON propre ; extrait les fichiers importés.
async function exportList(d, extractFiles) {
  const id = fileId(d);
  const files = [];
  const used = new Set();
  const firstText = d.columns.find(c => c.type === 'text');
  const rows = d.rows.filter(r => d.columns.some(c => !isEmpty(r[c.key]))).map((r, i) => {
    let rid = r.id || slugify(textOf(firstText ? r[firstText.key] : '')) || 'l' + (i + 1);
    while (used.has(rid)) rid += '-' + (i + 1);
    used.add(rid);
    const out = { id: rid };
    for (const c of d.columns) {
      let v = r[c.key];
      if (isEmpty(v)) continue;
      if ((c.type === 'image' || c.type === 'audio') && extractFiles) {
        const src = typeof v === 'string' ? v : v.src;
        if (src?.startsWith('data:')) {
          const { bytes, ext } = dataURLToBytes(src);
          const name = `img/${id}/${rid}-${c.key}.${ext}`;
          files.push({ name, data: bytes });
          v = typeof v === 'string' ? name : { ...v, src: name };
        }
      }
      out[c.key] = v;
    }
    if (r.tags?.length) out.tags = r.tags;
    return out;
  });
  const list = { title: d.title, description: d.description || undefined, source: d.source || undefined, columns: d.columns, rows };
  return { json: JSON.stringify(list, null, 2) + '\n', files };
}

// ======================= Fichiers =======================

function readDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function resizeImage(file, max = 800) {
  const url = await readDataURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 250000) return url;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

function dataURLToBytes(url) {
  const [head, b64] = url.split(',');
  const mime = head.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
    'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/webm': 'webm' }[mime] || 'bin';
  return { bytes, ext };
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function githubPut(repo, branch, token, path, bytes, message) {
  const api = `https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  let sha;
  const get = await fetch(api + (branch ? `?ref=${encodeURIComponent(branch)}` : ''), { headers, cache: 'no-store' });
  if (get.ok) sha = (await get.json()).sha;
  else if (get.status !== 404) throw new Error(`${get.status} ${(await get.json().catch(() => ({}))).message || ''}`);
  const body = { message, content: bytesToBase64(bytes), ...(branch ? { branch } : {}), ...(sha ? { sha } : {}) };
  const put = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!put.ok) throw new Error(`${put.status} ${(await put.json().catch(() => ({}))).message || ''}`);
}

// ZIP minimal sans compression (suffisant pour des images déjà compressées).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

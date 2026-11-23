// Éditeur de listes : brouillons locaux, export (.zip / .json), publication GitHub.
import { $, $$, esc, slugify, toast } from './util.js';
import { loadIndex, TYPES, textOf, mediaInfo, isEmpty, publicData, invalidateLists } from './data.js';
import { drafts } from './store.js';
import { connection, connect, disconnect, commitFiles, readFile, guessRepo } from './github.js';
import { cloudEnabled, currentUser, saveMyList, getMyList, deleteMyList, savePublicList, hidePublicList } from './cloud.js';
import { askLogin } from './social.js';

const newDraftId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ======================= Accueil de l'éditeur =======================

export async function renderEditorHome(el) {
  const all = Object.values(drafts.all());
  const everything = await loadIndex();
  const index = everything.filter(l => !l.draft && !l.mine);
  const mine = everything.filter(l => l.mine);
  const conn = connection();
  const me = currentUser();
  el.innerHTML = `<section>
    <div class="page-head"><h1>Éditeur de listes</h1>
      <p class="muted">${me ? 'Vos listes perso sont privées et vous suivent sur tous vos appareils.'
        : cloudEnabled ? '<a href="#/compte">Connectez-vous</a> pour garder vos listes sur tous vos appareils. Sans compte, elles restent sur cet appareil.'
        : 'Les listes restent sur cet appareil tant qu’elles ne sont pas enregistrées.'}</p></div>
    ${conn ? connectPanel(conn) : ''}
    <div class="actions">
      <button class="btn primary" id="new">+ Nouvelle liste</button>
      <label class="btn">Importer un .json<input type="file" accept=".json,application/json" id="import" hidden></label>
    </div>
    ${mine.length ? `<div class="panel"><h2>Mes listes perso</h2>
      <div class="chips">${mine.map(l => `<button class="chip" data-mine="${esc(l.id.slice(6))}">✎ ${esc(l.title)}</button>`).join('')}</div></div>` : ''}
    ${(conn || me?.isAdmin) && index.length ? `<div class="panel"><h2>Listes du site (pour tout le monde)</h2>
      <p class="hint">Choisissez une liste pour la modifier.</p>
      <div class="chips">${index.map(l => `<button class="chip" data-copy="${esc(l.id)}">✎ ${esc(l.title)}</button>`).join('')}</div></div>` : ''}
    <h2>En cours sur cet appareil</h2>
    ${all.length ? `<div class="list-grid">${all.map(d => `
      <a class="list-card" href="#/editeur/${d._draftId}">
        <h3>${esc(d.title || 'Sans titre')}</h3>
        <p class="small muted">${(d.rows || []).length} fiches · ${!d._dirty && d._publishedAt ? '✓ publiée sur le site' : !d._dirty && d._cloudId ? '✓ dans mes listes' : 'pas encore enregistrée'}</p>
      </a>`).join('')}</div>` : '<div class="empty">Rien en cours.</div>'}
    ${conn || me?.isAdmin ? '' : `<details class="panel admin"><summary>Publier des listes pour tout le monde (administrateur du site)</summary>${connectPanel(null)}</details>`}
  </section>`;
  $$('[data-mine]', el).forEach(b => b.onclick = async () => {
    const cid = b.dataset.mine;
    const existing = Object.values(drafts.all()).find(x => x._cloudId === cid);
    if (existing?._dirty) { location.hash = '#/editeur/' + existing._draftId; return; }
    if (existing) drafts.remove(existing._draftId);
    const l = await getMyList(cid);
    if (!l) { toast('Liste introuvable', 'err'); return; }
    const data = { ...l.data, _cloudId: cid, _draftId: newDraftId() };
    drafts.save(data);
    location.hash = '#/editeur/' + data._draftId;
  });

  bindConnect(el, () => renderEditorHome(el));
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
    const id = b.dataset.copy;
    // Un brouillon déjà ouvert pour cette liste ? On le reprend.
    const existing = Object.values(drafts.all()).find(x => x._origin === id);
    if (existing?._dirty) { location.hash = '#/editeur/' + existing._draftId; return; }
    if (existing) drafts.remove(existing._draftId);
    const online = await publicData(id);
    const fresh = online ? null : await readFile(`lists/${id}.json`);
    const data = online || (fresh ? JSON.parse(fresh) : await (await fetch(`lists/${encodeURIComponent(id)}.json`, { cache: 'no-cache' })).json());
    data.id = id;
    data._origin = id;
    data._draftId = newDraftId();
    drafts.save(data);
    location.hash = '#/editeur/' + data._draftId;
  });
}

function connectPanel(conn) {
  if (conn) {
    return `<div class="panel connected"><span>✓ Cet appareil peut enregistrer sur le site (${esc(conn.repo)}).</span>
      <button class="btn ghost small" id="gh-copy">Lien pour connecter un autre appareil</button>
      <button class="btn ghost small" id="gh-off">Déconnecter</button>
      <p class="hint" id="gh-copy-hint" hidden>Lien copié. Ouvrez-le sur votre autre appareil (en vous l’envoyant par message, par exemple) : il sera connecté directement. Ne le partagez avec personne d’autre, il permet de modifier le site.</p></div>`;
  }
  return `<div class="panel">
    <h2>Connecter cet appareil (une seule fois)</h2>
    <p class="hint">Pour enregistrer des listes sur le site, il faut une clé d’accès GitHub :</p>
    <ol class="steps">
      <li>Ouvrez <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">cette page GitHub</a> (connecté à votre compte).</li>
      <li>Nom : « quizz ». Expiration : la plus longue proposée.</li>
      <li><b>Repository access</b> : « Only select repositories » → choisissez <b>${esc(guessRepo() || 'votre dépôt')}</b>.</li>
      <li><b>Permissions</b> → Repository permissions → <b>Contents</b> : « Read and write ».</li>
      <li>« Generate token », copiez la clé et collez-la ici.</li>
    </ol>
    <div class="inline-form"><input id="gh-token" type="password" placeholder="github_pat_…" autocomplete="off" aria-label="Clé GitHub">
      <button class="btn primary" id="gh-connect">Connecter</button></div>
    ${guessRepo() ? '' : '<label class="small muted">Dépôt (propriétaire/nom)<input id="gh-repo" placeholder="gladuro/quizz"></label>'}
    <p class="hint" id="gh-msg"></p>
  </div>`;
}

function bindConnect(el, done) {
  const btn = $('#gh-connect', el);
  if (btn) btn.onclick = async () => {
    const msg = $('#gh-msg', el);
    const repo = guessRepo() || $('#gh-repo', el)?.value || '';
    const token = $('#gh-token', el).value;
    if (!token.trim() || !/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) { msg.textContent = 'Collez la clé (et le dépôt).'; return; }
    btn.disabled = true;
    msg.textContent = 'Vérification…';
    try { await connect(token, repo); toast('Appareil connecté'); done(); }
    catch (e) { msg.textContent = 'Impossible : ' + e.message; btn.disabled = false; }
  };
  const off = $('#gh-off', el);
  if (off) off.onclick = () => { disconnect(); done(); };
  const copy = $('#gh-copy', el);
  if (copy) copy.onclick = async () => {
    const c = connection();
    const link = `${location.origin}${location.pathname}#/connexion/${encodeURIComponent(c.repo)}/${encodeURIComponent(c.token)}`;
    try { await navigator.clipboard.writeText(link); } catch { prompt('Copiez ce lien :', link); }
    $('#gh-copy-hint', el).hidden = false;
  };
}

// Ouverture d'un lien de connexion venant d'un autre appareil.
export async function renderConnectLink(el, repo, token) {
  history.replaceState(null, '', location.pathname + '#/editeur');
  el.innerHTML = '<div class="empty">Connexion…</div>';
  try {
    await connect(decodeURIComponent(token), decodeURIComponent(repo));
    toast('Appareil connecté : vous pouvez enregistrer des listes sur le site');
  } catch (e) { toast('Lien de connexion invalide : ' + e.message, 'err'); }
  renderEditorHome(el);
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
    d._dirty = true;
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
        <a href="#/editeur" class="back">← Éditeur</a>
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
        <h2>Enregistrer</h2>
        <div class="actions">
          ${currentUser() && !d._origin ? `<button class="btn primary big" id="save-mine">💾 Enregistrer dans mes listes</button>` : ''}
          ${currentUser()?.isAdmin || connection() ? `<button class="btn ${currentUser() && !d._origin ? '' : 'primary big'}" id="publish">🌍 Publier sur le site pour tout le monde</button>` : ''}
          ${!currentUser() && !connection() && cloudEnabled ? `<button class="btn primary" id="login-save">Se connecter pour enregistrer</button>` : ''}
          <a class="btn" href="#/liste/brouillon:${d._draftId}">▶ Essayer</a>
        </div>
        <p class="hint" id="pub-msg">${statusText()}</p>
        <details class="gh"><summary>Autres options</summary>
          <div class="actions">
            <button class="btn" id="dl-zip">Télécharger (.zip avec images)</button>
            <button class="btn" id="dl-json">Télécharger le .json seul</button>
            <button class="btn ghost" id="del">Abandonner ce brouillon</button>
            ${d._origin && (connection() || currentUser()?.isAdmin) ? `<button class="btn ghost danger" id="unpublish">Supprimer la liste du site</button>` : ''}
            ${d._cloudId && currentUser() ? `<button class="btn ghost danger" id="del-mine">Supprimer de mes listes</button>` : ''}
          </div>
        </details>
      </div>
    </section>`;
    bind();
  }

  function cellHTML(c, v) {
    if (c.type === 'image' || c.type === 'audio') {
      const m = mediaInfo({ _base: 'lists/' }, v);
      const shown = !v ? '' : typeof v === 'string' ? (v.startsWith('data:') ? '(fichier importé)' : v)
        : v.wikipedia ? 'wikipedia:' + [].concat(v.wikipedia)[0] : (v.src?.startsWith('data:') ? '(fichier importé)' : v.src || '');
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
    if (d._origin || d._cloudId || (d.id && d.id !== slugify(d.title))) $('[data-meta="id"]', el).dataset.touched = '1';

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
    bindPublish();
  }

  function statusText() {
    if (d._dirty) return d._cloudId || d._publishedAt ? 'Modifications pas encore enregistrées.' : 'Pas encore enregistrée : pour l’instant elle n’existe que sur cet appareil.';
    if (d._publishedAt) return '✓ Publiée sur le site.';
    if (d._cloudId) return '✓ Enregistrée dans mes listes (visible sur tous mes appareils).';
    return 'Pas encore enregistrée : pour l’instant elle n’existe que sur cet appareil.';
  }

  function bindPublish() {
    const msg = $('#pub-msg', el);
    const ls = $('#login-save', el);
    if (ls) ls.onclick = () => askLogin('#/editeur/' + d._draftId);
    const sm = $('#save-mine', el);
    if (sm) sm.onclick = async () => {
      if (!d.title?.trim()) { msg.textContent = 'Donnez d’abord un titre à la liste.'; $('[data-meta="title"]', el).focus(); return; }
      sm.disabled = true;
      try {
        msg.textContent = 'Préparation des images…';
        const { json } = await exportList(d, false);
        const data = JSON.parse(json);
        await resolveWikipediaImages(data, t => { msg.textContent = t; });
        msg.textContent = 'Enregistrement…';
        d._cloudId = await saveMyList(d._cloudId, data);
        Object.assign(d, { columns: data.columns, rows: data.rows, _dirty: false });
        drafts.save(d);
        render();
        toast('Enregistrée dans mes listes');
      } catch (e) {
        msg.textContent = 'Échec de l’enregistrement : ' + e.message;
        sm.disabled = false;
      }
    };
    const dm = $('#del-mine', el);
    if (dm) dm.onclick = async () => {
      if (!dm.dataset.confirm) { dm.dataset.confirm = 1; dm.textContent = 'Cliquer encore pour supprimer'; return; }
      try {
        await deleteMyList(d._cloudId);
        drafts.remove(d._draftId);
        toast('Liste supprimée');
        location.hash = '#/editeur';
      } catch (e) { msg.textContent = 'Échec : ' + e.message; }
    };
    const pub = $('#publish', el);
    if (pub) pub.onclick = async () => {
      if (!d.title?.trim()) { msg.textContent = 'Donnez d’abord un titre à la liste.'; $('[data-meta="title"]', el).focus(); return; }
      const id = fileId(d);
      if (id !== d._origin) {
        const index = await loadIndex();
        if (index.some(l => !l.draft && l.id === id) && pub.dataset.confirm !== id) {
          pub.dataset.confirm = id;
          msg.textContent = `Une liste « ${id} » existe déjà sur le site : cliquez encore pour la remplacer, ou changez l’identifiant.`;
          return;
        }
      }
      pub.disabled = true;
      if (currentUser()?.isAdmin) {
        try {
          msg.textContent = 'Préparation des images…';
          const { json } = await exportList(d, false);
          const data = JSON.parse(json);
          await resolveWikipediaImages(data, t => { msg.textContent = t; });
          msg.textContent = 'Publication…';
          await savePublicList(id, data);
          if (d._origin && d._origin !== id) await hidePublicList(d._origin, d.title);
          Object.assign(d, { columns: data.columns, rows: data.rows, id, _origin: id, _publishedAt: Date.now(), _dirty: false });
          drafts.save(d);
          invalidateLists();
          render();
          $('#pub-msg', el).textContent = '✓ Publiée : tout le monde la voit dès maintenant.';
          toast('Liste publiée pour tout le monde');
        } catch (e) {
          msg.textContent = 'Échec de la publication : ' + e.message;
          pub.disabled = false;
        }
        return;
      }
      try {
        const { json, files } = await exportList(d, true);
        const all = [...files.map(f => ({ path: 'lists/' + f.name, data: f.data })), { path: `lists/${id}.json`, data: new TextEncoder().encode(json) }];
        // Identifiant changé : l'ancienne version est retirée du site.
        if (d._origin && d._origin !== id) all.push({ path: `lists/${d._origin}.json`, data: null });
        await commitFiles(all, `Liste « ${d.title} »`, step => { msg.textContent = step; });
        // Les fichiers importés sont désormais sur le site : on garde le brouillon léger.
        const saved = JSON.parse(json);
        Object.assign(d, { columns: saved.columns, rows: saved.rows, id, _origin: id, _publishedAt: Date.now(), _dirty: false });
        drafts.save(d);
        render();
        $('#pub-msg', el).textContent = '✓ Enregistrée sur le site. Elle sera visible sur tous vos appareils dans une minute environ (images Wikipédia comprises).';
        toast('Liste enregistrée sur le site');
      } catch (e) {
        msg.textContent = 'Échec de l’enregistrement : ' + e.message;
        pub.disabled = false;
      }
    };
    const un = $('#unpublish', el);
    if (un) un.onclick = async () => {
      if (!un.dataset.confirm) { un.dataset.confirm = 1; un.textContent = 'Cliquer encore pour supprimer du site'; return; }
      un.disabled = true;
      if (currentUser()?.isAdmin) {
        try {
          await hidePublicList(d._origin, d.title);
          drafts.remove(d._draftId);
          invalidateLists();
          toast('Liste retirée du site');
          location.hash = '#/editeur';
        } catch (e) { msg.textContent = 'Échec : ' + e.message; un.disabled = false; }
        return;
      }
      try {
        await commitFiles([{ path: `lists/${d._origin}.json`, data: null }], `Suppression de la liste « ${d.title} »`, step => { msg.textContent = step; });
        drafts.remove(d._draftId);
        toast('Liste supprimée du site (dans une minute environ)');
        location.hash = '#/editeur';
      } catch (e) { msg.textContent = 'Échec : ' + e.message; un.disabled = false; }
    };
  }

  render();
}

const fileId = d => slugify(d.id || d.title);

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

// Pour les listes perso (pas de déploiement GitHub) : on récupère l'image Wikipédia directement depuis le navigateur.
async function resolveWikipediaImages(list, say) {
  const cols = list.columns.filter(c => c.type === 'image');
  for (const row of list.rows) {
    for (const c of cols) {
      const v = row[c.key];
      if (!v || typeof v !== 'object' || v.src || !v.wikipedia) continue;
      for (const ref of [].concat(v.wikipedia)) {
        const m = String(ref).match(/^([a-z]{2,3}):(.+)$/);
        const lang = m ? m[1] : 'fr', title = m ? m[2] : ref;
        try {
          say(`Image Wikipédia : ${title}…`);
          const api = `https://${lang}.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query`;
          const q = await (await fetch(`${api}&prop=pageimages&piprop=name&redirects=1&titles=${encodeURIComponent(title)}`)).json();
          const file = q.query?.pages?.[0]?.pageimage;
          if (!file) continue;
          const info = await (await fetch(`${api}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&titles=${encodeURIComponent('File:' + file)}`)).json();
          const ii = info.query?.pages?.[0]?.imageinfo?.[0];
          if (!ii) continue;
          const strip = h => { const t = document.createElement('div'); t.innerHTML = h || ''; return t.textContent.trim(); };
          row[c.key] = { ...v, src: ii.thumburl || ii.url, credit: strip(ii.extmetadata?.Artist?.value) || 'Auteur inconnu',
            license: strip(ii.extmetadata?.LicenseShortName?.value), source: ii.descriptionurl };
          break;
        } catch (e) { console.warn('Image Wikipédia introuvable', ref, e); }
      }
    }
  }
}

// Préparation d'un entraînement, déroulé des questions, révision.
import { $, $$, esc, shuffle, sample, matchText, parseNumber, parseUserDate, parseDate, toast } from './util.js';
import { loadList, loadIndex, display, sortKey, mediaInfo, mediaHTML, cardHTML, isEmpty, textOf,
  filterColumns, allTags, applyFilters } from './data.js';
import { progress, history, favorites, lastConfig } from './store.js';
import { cloudEnabled, currentUser, submitScore, createChallenge } from './cloud.js';

let keyHandler = null;
export function clearKeys() {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
}
function onKeys(fn) {
  clearKeys();
  keyHandler = fn;
  document.addEventListener('keydown', fn);
}

const isMedia = c => c.type === 'image' || c.type === 'audio';
const orderable = c => c.type === 'date' || c.type === 'number';

function defaultConfig(list) {
  const img = list.columns.find(c => c.type === 'image');
  const texts = list.columns.filter(c => c.type === 'text');
  const show = img ? [img.key] : texts[1] ? [texts[1].key] : [];
  const find = texts[0] ? [texts[0].key] : [];
  return { show, find, mode: 'qcm', count: 10, filters: { tags: [], values: {} }, orderCol: list.columns.find(orderable)?.key || null };
}

// ======================= Écran de préparation =======================

export async function renderSetup(el, listId, preset = null) {
  const list = await loadList(listId);
  const cfg = structuredClone(preset || lastConfig.get(listId) || defaultConfig(list));
  cfg.filters ||= { tags: [], values: {} };
  cfg.filters.values ||= {};
  cfg.filters.tags ||= [];
  const known = new Set(list.columns.map(c => c.key));
  cfg.show = cfg.show.filter(k => known.has(k));
  cfg.find = cfg.find.filter(k => known.has(k));

  const tags = allTags(list);
  const fcols = filterColumns(list);
  const hasOrder = list.columns.some(orderable);
  const pending = progress.pending(listId);

  el.innerHTML = `
    <section class="setup">
      <div class="page-head">
        <a href="#/" class="back">← Listes</a>
        <h1>${esc(list.title)}</h1>
        ${list.description ? `<p class="muted">${esc(list.description)}</p>` : ''}
        <p class="muted small">${list.rows.length} fiches${list.source ? ` · ${esc(list.source)}` : ''}</p>
      </div>

      <div class="panel">
        <h2>Mode</h2>
        <div class="seg" id="mode">
          <button data-v="qcm">Choix multiple</button>
          <button data-v="libre">Saisie libre</button>
          ${hasOrder ? '<button data-v="chrono">Remettre dans l’ordre</button>' : ''}
          <button data-v="cartes">Cartes mémoire</button>
        </div>
        <p class="hint" id="mode-hint"></p>
      </div>

      <div class="panel">
        <h2>Colonnes</h2>
        <p class="hint" id="cols-hint"></p>
        <div class="cols" id="cols">
          ${list.columns.map(c => `
            <div class="col-row" data-key="${esc(c.key)}">
              <span class="col-name">${esc(c.label)} <span class="type">${esc(c.type)}</span></span>
              <div class="seg small">
                <button data-v="hide">Cachée</button>
                <button data-v="show">Montrée</button>
                <button data-v="find" class="find-btn">À trouver</button>
                ${orderable(c) ? '<button data-v="order" class="order-btn">Ordonner</button>' : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>

      ${tags.length || fcols.length ? `
      <div class="panel">
        <h2>Filtres <span class="muted small">(aucun = tout)</span></h2>
        ${tags.length ? `<div class="filter-group"><span class="lbl">Étiquettes</span><div class="chips" data-filter="tags">
          ${tags.map(t => `<button class="chip" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>` : ''}
        ${fcols.map(c => {
          const vals = [...new Set(list.rows.map(r => String(textOf(r[c.key]))).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
          return `<div class="filter-group"><span class="lbl">${esc(c.label)}</span><div class="chips" data-filter="${esc(c.key)}">
            ${vals.map(v => `<button class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div></div>`;
        }).join('')}
      </div>` : ''}

      <div class="panel">
        <h2>Nombre de questions</h2>
        <div class="seg" id="count">
          <button data-v="10">10</button><button data-v="20">20</button><button data-v="50">50</button><button data-v="0">Toutes</button>
        </div>
        <p class="hint" id="pool"></p>
      </div>

      <div class="actions sticky">
        <button class="btn primary big" id="go">Commencer</button>
        ${pending ? `<a class="btn" href="#/revision/${encodeURIComponent(listId)}">Revoir mes erreurs (${pending})</a>` : ''}
        <button class="btn ghost" id="save-fav">☆ Enregistrer la combinaison</button>
        ${cloudEnabled && currentUser() && !listId.startsWith('brouillon:') ? '<button class="btn ghost" id="dare">⚔️ Créer un défi</button>' : ''}
      </div>

      <details class="panel browse">
        <summary>Parcourir les fiches</summary>
        <div class="cards" id="cards"></div>
      </details>
    </section>`;

  const role = key => key === cfg.orderCol && cfg.mode === 'chrono' ? 'order'
    : cfg.show.includes(key) ? 'show' : cfg.find.includes(key) ? 'find' : 'hide';

  function refresh() {
    $$('#mode button', el).forEach(b => b.classList.toggle('on', b.dataset.v === cfg.mode));
    $('#mode-hint', el).textContent = {
      qcm: 'Quatre propositions par colonne à trouver.',
      libre: 'Tapez la réponse : accents, majuscules et petites fautes de frappe sont tolérés. Les images et sons restent en choix multiple.',
      chrono: 'Quatre fiches à remettre dans l’ordre selon la colonne « Ordonner ».',
      cartes: 'Retournez chaque carte, puis dites si vous la maîtrisez. Les cartes pas maîtrisées reviennent jusqu’à ce que tout soit su.',
    }[cfg.mode];
    $('#cols-hint', el).textContent = cfg.mode === 'chrono'
      ? 'Choisissez ce qui est montré pour chaque fiche, et la colonne qui sert à ordonner.'
      : cfg.mode === 'cartes'
      ? 'Recto : ce qu’on voit d’abord. Verso : ce qu’on découvre en retournant la carte. Plusieurs colonnes possibles de chaque côté.'
      : 'Montrée : affichée dans la question. À trouver : ce qu’on vous demande (une ou plusieurs). Seules les colonnes « À trouver » sont notées.';
    $$('.col-row', el).forEach(row => {
      const key = row.dataset.key;
      const r = role(key);
      $$('button', row).forEach(b => b.classList.toggle('on', b.dataset.v === r));
      $$('.find-btn', row).forEach(b => b.hidden = cfg.mode === 'chrono');
      $$('.order-btn', row).forEach(b => b.hidden = cfg.mode !== 'chrono');
      $('[data-v="show"]', row).textContent = cfg.mode === 'cartes' ? 'Recto' : 'Montrée';
      $('[data-v="find"]', row).textContent = cfg.mode === 'cartes' ? 'Verso' : 'À trouver';
    });
    const dare = $('#dare', el);
    if (dare) dare.hidden = cfg.mode === 'cartes';
    $$('#count button', el).forEach(b => b.classList.toggle('on', +b.dataset.v === cfg.count));
    $$('.chips', el).forEach(g => {
      const f = g.dataset.filter;
      const sel = f === 'tags' ? cfg.filters.tags : (cfg.filters.values[f] || []);
      $$('.chip', g).forEach(c => c.classList.toggle('on', sel.includes(c.dataset.v)));
    });
    const pool = applyFilters(list, cfg.filters);
    $('#pool', el).textContent = `${pool.length} fiche${pool.length > 1 ? 's' : ''} correspond${pool.length > 1 ? 'ent' : ''} aux filtres.`;
    const ok = cfg.mode === 'chrono' ? !!cfg.orderCol
      : cfg.mode === 'cartes' ? cfg.show.length > 0 && cfg.find.length > 0
      : cfg.find.length > 0;
    $('#go', el).disabled = !ok || pool.length < (cfg.mode === 'chrono' ? 2 : 1);
  }

  $('#mode', el).addEventListener('click', e => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v) return;
    cfg.mode = v;
    if (v === 'chrono' && !cfg.orderCol) cfg.orderCol = list.columns.find(orderable)?.key;
    refresh();
  });
  $('#cols', el).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const key = b.closest('.col-row').dataset.key;
    cfg.show = cfg.show.filter(k => k !== key);
    if (cfg.mode !== 'chrono') cfg.find = cfg.find.filter(k => k !== key);
    if (b.dataset.v === 'show') cfg.show.push(key);
    if (b.dataset.v === 'find') cfg.find.push(key);
    if (b.dataset.v === 'order') cfg.orderCol = key;
    else if (key === cfg.orderCol && cfg.mode === 'chrono') cfg.orderCol = null;
    refresh();
  });
  $('#count', el).addEventListener('click', e => {
    const v = e.target.closest('button')?.dataset.v;
    if (v !== undefined) { cfg.count = +v; refresh(); }
  });
  $$('.chips', el).forEach(g => g.addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const f = g.dataset.filter;
    const arr = f === 'tags' ? cfg.filters.tags : (cfg.filters.values[f] ||= []);
    const i = arr.indexOf(c.dataset.v);
    i >= 0 ? arr.splice(i, 1) : arr.push(c.dataset.v);
    refresh();
  }));
  $('#go', el).addEventListener('click', () => {
    lastConfig.set(listId, cfg);
    startSession(el, list, cfg);
  });
  const dareBtn = $('#dare', el);
  if (dareBtn) dareBtn.onclick = async () => {
    const qs = buildQuestions(list, cfg);
    if (!qs.length) { toast('Aucune question possible avec ces réglages', 'err'); return; }
    dareBtn.disabled = true;
    try {
      lastConfig.set(listId, cfg);
      location.hash = '#/defi/' + await makeChallenge(list, cfg, qs);
    } catch (e) { toast('Défi non créé : ' + e.message, 'err'); dareBtn.disabled = false; }
  };
  $('#save-fav', el).addEventListener('click', () => {
    const btn = $('#save-fav', el);
    const lbl = c => list.columns.find(x => x.key === c)?.label;
    const guess = cfg.mode === 'chrono'
      ? `${list.title} : ordre par ${lbl(cfg.orderCol)}`
      : `${list.title} : ${cfg.show.map(lbl).join(' + ') || '…'} → ${cfg.find.map(lbl).join(' + ')}`;
    const form = document.createElement('form');
    form.className = 'inline-form';
    form.innerHTML = `<input value="${esc(guess)}" aria-label="Nom de la combinaison"><button class="btn primary">Enregistrer</button>`;
    btn.replaceWith(form);
    form.querySelector('input').select();
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      favorites.add({ name: form.querySelector('input').value.trim() || guess, listId, cfg: structuredClone(cfg) });
      toast('Combinaison enregistrée sur la page d’accueil');
      form.replaceWith(btn);
    });
  });
  $('.browse', el).addEventListener('toggle', e => {
    if (e.target.open && !$('#cards', el).childElementCount) {
      $('#cards', el).innerHTML = list.rows.map(r => cardHTML(list, r)).join('');
    }
  }, { once: false });

  refresh();
}

// ======================= Construction des questions =======================

function buildQuestions(list, cfg) {
  const pool = applyFilters(list, cfg.filters);
  if (cfg.mode === 'chrono') {
    const col = list.columns.find(c => c.key === cfg.orderCol);
    const usable = pool.filter(r => sortKey(col, r[col.key]) !== null);
    const n = cfg.count || Math.max(5, Math.floor(usable.length / 4));
    const qs = [];
    for (let i = 0; i < n; i++) {
      const picked = [];
      const keys = new Set();
      for (const r of shuffle(usable)) {
        const k = sortKey(col, r[col.key]);
        if (keys.has(k)) continue;
        keys.add(k);
        picked.push(r);
        if (picked.length === 4) break;
      }
      if (picked.length < 2) break;
      qs.push({ kind: 'chrono', rows: picked, orderCol: col.key, show: cfg.show });
    }
    return qs;
  }
  const usable = cfg.mode === 'cartes'
    ? pool.filter(r => cfg.show.some(k => !isEmpty(r[k])) && cfg.find.some(k => !isEmpty(r[k])))
    : pool.filter(r => cfg.find.every(k => !isEmpty(r[k])) && (!cfg.show.length || cfg.show.some(k => !isEmpty(r[k]))));
  const rows = shuffle(usable);
  return (cfg.count ? rows.slice(0, cfg.count) : rows).map(row => ({ kind: 'q', row, show: cfg.show, find: cfg.find }));
}

function choiceKey(list, col, v) {
  if (isMedia(col)) return mediaInfo(list, v)?.src || JSON.stringify(v);
  return display(col, v);
}

function buildChoices(list, col, row, pool) {
  const correct = row[col.key];
  const ck = choiceKey(list, col, correct);
  const seen = new Set([ck]);
  const opts = [];
  const fromRows = rows => {
    for (const r of shuffle(rows)) {
      if (opts.length >= 3) break;
      const v = r[col.key];
      if (isEmpty(v)) continue;
      const k = choiceKey(list, col, v);
      if (seen.has(k)) continue;
      seen.add(k);
      opts.push({ v, rowId: r._id });
    }
  };
  fromRows(pool);
  fromRows(list.rows);
  const all = shuffle([{ v: correct, ok: true, rowId: row._id }, ...opts.map(o => ({ ...o, ok: false }))]);
  return all;
}

// ======================= Déroulé =======================

export function startSession(el, list, cfg, { questions = null, review = false, challenge = null } = {}) {
  if (cfg.mode === 'cartes') return startFlashcards(el, list, cfg, questions && questions.map(q => q.row));
  const qs = questions || buildQuestions(list, cfg);
  if (!qs.length) { toast('Aucune question possible avec ces réglages', 'err'); return; }
  const pool = applyFilters(list, cfg.filters || {});
  const state = { i: 0, score: 0, results: [], start: Date.now() };
  const col = k => list.columns.find(c => c.key === k);

  function header() {
    return `<div class="quiz-head">
      <button class="btn ghost small" id="quit">✕ Arrêter</button>
      <div class="bar"><div style="width:${(state.i / qs.length) * 100}%"></div></div>
      <span class="count">${state.i + 1} / ${qs.length} · <b>${state.score}</b> ✓</span>
    </div>`;
  }

  function promptHTML(row, show) {
    const cols = show.map(col).filter(Boolean);
    const media = cols.filter(isMedia).map(c => mediaHTML(list, c, row[c.key], 'big')).join('');
    const texts = cols.filter(c => !isMedia(c) && !isEmpty(row[c.key]))
      .map(c => `<div class="prompt-field"><span class="lbl">${esc(c.label)}</span><span class="val">${esc(display(c, row[c.key]))}</span></div>`).join('');
    return `<div class="prompt">${media}${texts}</div>`;
  }

  function render() {
    const q = qs[state.i];
    if (q.kind === 'chrono') return renderChrono(q);
    const find = q.find.map(col).filter(Boolean);
    const modeOf = c => (cfg.mode === 'qcm' || isMedia(c)) ? 'qcm' : 'libre';
    q.choices = {};
    el.innerHTML = `<section class="quiz">${header()}
      ${promptHTML(q.row, q.show)}
      <form class="answers" id="answers" autocomplete="off">
        ${find.map((c, idx) => {
          if (modeOf(c) === 'libre') {
            const ph = c.type === 'date' ? 'ex. 1515' : c.type === 'number' ? 'un nombre' + (c.unit ? ' (' + c.unit + ')' : '') : '';
            return `<label class="answer" data-key="${esc(c.key)}"><span class="lbl">${esc(c.label)} ?</span>
              <input name="${esc(c.key)}" ${c.type === 'number' ? 'inputmode="decimal"' : ''} placeholder="${esc(ph)}" ${idx === 0 ? 'autofocus' : ''} autocapitalize="off" spellcheck="false"></label>`;
          }
          const choices = q.choices[c.key] = q.fixedChoices?.[c.key] || buildChoices(list, c, q.row, pool);
          return `<div class="answer" data-key="${esc(c.key)}"><span class="lbl">${esc(c.label)} ?</span>
            <div class="choices ${isMedia(c) ? 'media-choices' : ''}">
              ${choices.map((o, i) => `<button type="button" class="choice" data-i="${i}">${isMedia(c) ? mediaHTML(list, c, o.v) : esc(display(c, o.v))}</button>`).join('')}
            </div></div>`;
        }).join('')}
        <div class="actions"><button class="btn primary" id="validate">Valider</button>
        <button type="button" class="btn ghost" id="skip">Je ne sais pas</button></div>
      </form>
      <div id="feedback"></div>
    </section>`;
    $('#quit', el).onclick = finish;
    const singleQcm = find.length === 1 && modeOf(find[0]) === 'qcm';
    if (singleQcm) $('#validate', el).hidden = true;
    $$('.choices', el).forEach(g => g.addEventListener('click', e => {
      const b = e.target.closest('.choice');
      if (!b || g.classList.contains('done')) return;
      if (e.target.closest('a')) return;
      $$('.choice', g).forEach(x => x.classList.toggle('sel', x === b));
      if (singleQcm) check();
    }));
    $('#answers', el).addEventListener('submit', e => { e.preventDefault(); check(); });
    $('#skip', el).onclick = () => check(true);
    const first = $('input', el);
    if (first) first.focus();
    onKeys(e => {
      if (!singleQcm || e.target.tagName === 'INPUT') return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) $$('.choice', el)[n - 1]?.click();
    });

    function check(skipped = false) {
      const res = find.map(c => {
        const box = $(`.answer[data-key="${CSS.escape(c.key)}"]`, el);
        const expected = q.row[c.key];
        let ok = false, given = '', note = '';
        if (modeOf(c) === 'qcm') {
          const sel = $('.choice.sel', box);
          const choices = q.choices[c.key];
          if (sel && !skipped) {
            const o = choices[+sel.dataset.i];
            ok = o.ok;
            given = isMedia(c) ? '' : display(c, o.v);
          }
          $$('.choice', box).forEach((b, i) => {
            if (choices[i].ok) b.classList.add('good');
            else if (b.classList.contains('sel')) b.classList.add('bad');
          });
          $('.choices', box).classList.add('done');
        } else {
          const input = $('input', box);
          given = skipped ? '' : input.value.trim();
          input.disabled = true;
          if (given) {
            if (c.type === 'number') {
              const n = parseNumber(given), exp = Number(expected);
              const tol = typeof c.tolerance === 'string' && c.tolerance.endsWith('%')
                ? Math.abs(exp) * parseFloat(c.tolerance) / 100 : Number(c.tolerance || 0);
              ok = n !== null && Math.abs(n - exp) <= tol;
              if (ok && n !== exp) note = 'assez proche';
            } else if (c.type === 'date') {
              const u = parseUserDate(given), exp = parseDate(expected);
              const tol = Number(c.tolerance || 0);
              ok = !!(u && exp && Math.abs(u.y - exp.y) <= tol);
              if (ok && u.y !== exp.y) note = 'assez proche';
            } else {
              const accepted = Array.isArray(expected) ? expected : [expected];
              const m = matchText(given, accepted);
              ok = !!m;
              if (m === 'proche') note = 'petite faute tolérée';
            }
          }
          box.classList.add(ok ? 'good' : 'bad');
        }
        progress.record(list.id, q.row._id, c.key, ok, q.show);
        return { key: c.key, label: c.label, ok, given, note, expected: isMedia(c) ? '' : display(c, expected) };
      });
      const allOk = res.every(r => r.ok);
      if (allOk) state.score++;
      state.results.push({ row: q.row, ok: allOk, res, show: q.show, find: q.find });
      $('#validate', el).hidden = true;
      $('#skip', el).hidden = true;
      $('.quiz-head .count', el).innerHTML = `${state.i + 1} / ${qs.length} · <b>${state.score}</b> ✓`;
      $('#feedback', el).innerHTML = `
        <div class="verdict ${allOk ? 'good' : 'bad'}">
          ${res.map(r => `<div>${r.ok ? '✓' : '✗'} <b>${esc(r.label)}</b> :
            ${r.ok ? esc(r.expected || 'bonne réponse') + (r.note ? ` <span class="muted">(${esc(r.note)}${r.given && r.given !== r.expected ? ', vous avez écrit « ' + esc(r.given) + ' »' : ''})</span>` : '')
                   : `${r.given ? `<s>${esc(r.given)}</s> → ` : ''}${esc(r.expected || 'voir la fiche')}`}</div>`).join('')}
        </div>
        ${cardHTML(list, q.row, q.find)}
        <div class="actions"><button class="btn primary" id="next">${state.i + 1 < qs.length ? 'Suivant →' : 'Voir le résultat'}</button></div>`;
      const next = $('#next', el);
      next.focus({ preventScroll: true });
      $('#feedback', el).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      next.onclick = advance;
      onKeys(e => { if (e.key === 'Enter') { e.preventDefault(); advance(); } });
    }
  }

  function renderChrono(q) {
    const oc = col(q.orderCol);
    const showCols = (q.show.length ? q.show : [list.columns.find(c => c.type === 'text')?.key]).map(col).filter(c => c && c.key !== oc.key);
    const order = [];
    el.innerHTML = `<section class="quiz">${header()}
      <p class="chrono-q">Touchez les fiches dans l’ordre de <b>${esc(oc.label)}</b>, du plus petit (ou plus ancien) au plus grand.</p>
      <div class="chrono" id="chrono">
        ${q.rows.map((r, i) => `<button class="chrono-item" data-i="${i}"><span class="rank"></span>
          <span class="chrono-body">${showCols.map(c => isMedia(c) ? mediaHTML(list, c, r[c.key], 'thumb') : `<span>${esc(display(c, r[c.key]))}</span>`).join('')}</span>
          <span class="chrono-val"></span></button>`).join('')}
      </div>
      <div class="actions"><button class="btn primary" id="validate" disabled>Valider</button>
        <button class="btn ghost" id="reset">Recommencer l’ordre</button></div>
      <div id="feedback"></div></section>`;
    $('#quit', el).onclick = finish;
    const items = $$('.chrono-item', el);
    const paint = () => {
      items.forEach((b, i) => {
        const pos = order.indexOf(i);
        b.classList.toggle('picked', pos >= 0);
        $('.rank', b).textContent = pos >= 0 ? pos + 1 : '';
      });
      $('#validate', el).disabled = order.length !== items.length;
    };
    $('#chrono', el).addEventListener('click', e => {
      const b = e.target.closest('.chrono-item');
      if (!b || b.disabled) return;
      const i = +b.dataset.i;
      const pos = order.indexOf(i);
      pos >= 0 ? order.splice(pos) : order.push(i);
      if (order.length === items.length - 1) order.push(items.findIndex((_, j) => !order.includes(j)));
      paint();
    });
    $('#reset', el).onclick = () => { order.length = 0; paint(); };
    $('#validate', el).onclick = () => {
      const keyOf = i => sortKey(oc, q.rows[i][oc.key]);
      const correct = [...order].sort((a, b) => keyOf(a) - keyOf(b));
      const ok = order.every((v, i) => keyOf(v) === keyOf(correct[i]));
      if (ok) state.score++;
      state.results.push({ row: q.rows[0], rows: q.rows, ok, chrono: true });
      items.forEach((b, i) => {
        b.disabled = true;
        const pos = order.indexOf(i);
        const right = keyOf(i) === keyOf(correct[pos]);
        b.classList.add(right ? 'good' : 'bad');
        $('.chrono-val', b).textContent = display(oc, q.rows[i][oc.key]) + (right ? '' : ` (rang ${correct.indexOf(i) + 1})`);
      });
      $('#validate', el).hidden = true;
      $('#reset', el).hidden = true;
      $('.quiz-head .count', el).innerHTML = `${state.i + 1} / ${qs.length} · <b>${state.score}</b> ✓`;
      $('#feedback', el).innerHTML = `
        <div class="verdict ${ok ? 'good' : 'bad'}">${ok ? '✓ Bon ordre !' : '✗ Ordre correct :'}
          ${ok ? '' : '<ol>' + correct.map(i => `<li>${esc(showCols.filter(c => !isMedia(c)).map(c => display(c, q.rows[i][c.key])).join(' · ') || textOf(q.rows[i][list.columns.find(c => c.type === 'text')?.key]))} — ${esc(display(oc, q.rows[i][oc.key]))}</li>`).join('') + '</ol>'}</div>
        <details class="chrono-cards"><summary>Voir les fiches</summary><div class="cards">${correct.map(i => cardHTML(list, q.rows[i], [oc.key])).join('')}</div></details>
        <div class="actions"><button class="btn primary" id="next">${state.i + 1 < qs.length ? 'Suivant →' : 'Voir le résultat'}</button></div>`;
      const next = $('#next', el);
      next.focus({ preventScroll: true });
      next.onclick = advance;
      onKeys(e => { if (e.key === 'Enter') { e.preventDefault(); advance(); } });
    };
  }

  function advance() {
    state.i++;
    if (state.i >= qs.length) return finish();
    render();
    window.scrollTo({ top: 0 });
  }

  function finish() {
    clearKeys();
    const done = state.results.length;
    const lbl = k => col(k)?.label || k;
    const seconds = Math.round((Date.now() - state.start) / 1000);
    const exercise = exerciseLabel(list, cfg);
    let sent = null;
    if (done) {
      history.add({
        listId: list.id, listTitle: list.title, mode: cfg.mode, review,
        show: (cfg.show || []).map(lbl), find: cfg.mode === 'chrono' ? [lbl(cfg.orderCol)] : (cfg.find || []).map(lbl),
        score: state.score, total: done, seconds,
      });
      // Score en ligne (classement) : pas pour les révisions ni les brouillons.
      // Pour un défi, le total compte toutes les questions, même si on arrête avant la fin.
      if (currentUser() && !review && !list.id.startsWith('brouillon:')) {
        sent = submitScore({
          listId: challenge ? challenge.listId : list.id, listTitle: list.title, mode: cfg.mode, exercise,
          score: state.score, total: challenge ? qs.length : done, seconds, challengeId: challenge?.id,
        }).then(() => true).catch(e => { toast('Score non envoyé : ' + e.message, 'err'); return false; });
      }
    }
    const missed = state.results.filter(r => !r.ok);
    const pct = done ? Math.round(state.score / done * 100) : 0;
    el.innerHTML = `<section class="result">
      <h1>${done ? `${state.score} / ${done}` : 'Entraînement arrêté'}</h1>
      ${done ? `<div class="ring" style="--p:${pct}"><span>${pct} %</span></div>` : ''}
      <p class="muted">${esc(list.title)}${review ? ' · révision' : ''}${challenge ? ' · défi' : ''}</p>
      ${challenge ? `<div class="actions center"><a class="btn primary" href="#/defi/${esc(challenge.id)}">🏆 Voir le classement du défi</a></div>` : `
      <div class="actions center">
        <button class="btn primary" id="again">Recommencer</button>
        ${missed.length && !missed[0].chrono ? `<button class="btn" id="retry">Refaire les ${missed.length} ratée${missed.length > 1 ? 's' : ''}</button>` : ''}
        <a class="btn ghost" href="#/liste/${encodeURIComponent(list.id)}">Changer les réglages</a>
      </div>
      ${currentUser() && !review && done === qs.length ? `<div class="actions center"><button class="btn" id="dare">⚔️ Défier mes potes avec ces questions</button></div>` : ''}`}
      ${missed.length && !missed[0].chrono ? `<h2>À revoir</h2><p class="hint">Elles reviendront aussi dans « Révision » selon un calendrier espacé.</p>
        <div class="cards">${missed.map(r => cardHTML(list, r.row, r.find)).join('')}</div>` : ''}
    </section>`;
    const dare = $('#dare', el);
    if (dare) dare.onclick = async () => {
      dare.disabled = true;
      try {
        const id = await makeChallenge(list, cfg, qs);
        if (sent && await sent) await submitScore({ listId: list.id, listTitle: list.title, mode: cfg.mode, exercise, score: state.score, total: qs.length, seconds, challengeId: id }).catch(() => {});
        location.hash = '#/defi/' + id;
      } catch (e) { toast('Défi non créé : ' + e.message, 'err'); dare.disabled = false; }
    };
    const again = $('#again', el);
    if (again) again.onclick = () => startSession(el, list, cfg, { questions: questions ? shuffle(questions) : null, review });
    const retry = $('#retry', el);
    if (retry) retry.onclick = () => startSession(el, list, cfg, {
      questions: shuffle(missed.map(r => ({ kind: 'q', row: r.row, show: r.show, find: r.find }))), review,
    });
    window.scrollTo({ top: 0 });
  }

  render();
  window.scrollTo({ top: 0 });
}

// ======================= Cartes mémoire =======================
// Recto = colonnes « show », verso = colonnes « find ». Glisser à gauche (ou ←) : maîtrisée,
// à droite (ou →) : pas maîtrisée. Les cartes pas maîtrisées reviennent au tour suivant.

function startFlashcards(el, list, cfg, givenRows = null) {
  const rows = givenRows || buildQuestions(list, cfg).map(q => q.row);
  if (!rows.length) { toast('Aucune carte possible avec ces réglages', 'err'); return; }
  const col = k => list.columns.find(c => c.key === k);
  const st = {
    queue: shuffle(rows), again: [], round: 1, mastered: 0, total: rows.length,
    misses: new Map(), flipped: false, busy: false, start: Date.now(),
  };

  function face(row, keys) {
    const cols = keys.map(col).filter(c => c && !isEmpty(row[c.key]));
    const media = cols.filter(isMedia).map(c => mediaHTML(list, c, row[c.key], 'big')).join('');
    const texts = cols.filter(c => !isMedia(c)).map(c => {
      const v = row[c.key];
      const alt = Array.isArray(v) && v.length > 1 ? `<span class="alt">aussi : ${v.slice(1).map(esc).join(', ')}</span>` : '';
      return `<div class="prompt-field"><span class="lbl">${esc(c.label)}</span><span class="val">${esc(display(c, v))}</span>${alt}</div>`;
    }).join('');
    return media + texts;
  }

  function counter() {
    const left = st.total - st.mastered;
    return `<span class="count">✓ <b>${st.mastered}</b> / ${st.total} · encore ${left}${st.round > 1 ? ` · tour ${st.round}` : ''}</span>`;
  }

  function render() {
    const row = st.queue[0];
    st.flipped = false;
    st.busy = false;
    el.innerHTML = `<section class="quiz flash">
      <div class="quiz-head">
        <button class="btn ghost small" id="quit">✕ Arrêter</button>
        <div class="bar"><div style="width:${st.mastered / st.total * 100}%"></div></div>
        ${counter()}
      </div>
      <div class="fc-stage">
        <div class="fc" id="fc" tabindex="0" role="button" aria-label="Retourner la carte">
          <div class="fc-inner">
            <div class="fc-face fc-front"><span class="fc-side">Recto</span>${face(row, cfg.show)}</div>
            <div class="fc-face fc-back" aria-hidden="true"><span class="fc-side">Verso</span>${face(row, cfg.find)}</div>
          </div>
          <div class="fc-stamp yes">✓ Maîtrisée</div>
          <div class="fc-stamp no">✗ Pas encore</div>
        </div>
      </div>
      <div class="fc-actions">
        <button class="btn fc-yes" id="yes" title="Flèche gauche">← Maîtrisée</button>
        <button class="btn" id="flip" title="Espace">↻ Retourner</button>
        <button class="btn fc-no" id="no" title="Flèche droite">Pas encore →</button>
      </div>
      <p class="hint center">Touchez la carte pour la retourner, puis glissez-la à gauche si vous la maîtrisez, à droite sinon.
        Au clavier : espace pour retourner, ← et →.</p>
    </section>`;
    const fc = $('#fc', el);
    $('#quit', el).onclick = () => finish(true);
    $('#flip', el).onclick = flip;
    $('#yes', el).onclick = () => decide(true);
    $('#no', el).onclick = () => decide(false);
    swipe(fc);
    onKeys(e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); decide(true); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); decide(false); }
    });
  }

  function flip() {
    if (st.busy) return;
    st.flipped = !st.flipped;
    const fc = $('#fc', el);
    fc.classList.toggle('flipped', st.flipped);
    $('.fc-front', fc).setAttribute('aria-hidden', st.flipped);
    $('.fc-back', fc).setAttribute('aria-hidden', !st.flipped);
  }

  function swipe(fc) {
    let x0 = null, y0 = 0, dx = 0, dy = 0, id = null;
    const paint = () => {
      fc.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      $('.fc-stamp.yes', fc).style.opacity = Math.min(1, Math.max(0, -dx / 90));
      $('.fc-stamp.no', fc).style.opacity = Math.min(1, Math.max(0, dx / 90));
    };
    fc.addEventListener('pointerdown', e => {
      if (st.busy || e.button > 0 || e.target.closest('a, audio')) return;
      x0 = e.clientX; y0 = e.clientY; dx = dy = 0; id = e.pointerId;
      fc.classList.add('dragging');
    });
    fc.addEventListener('pointermove', e => {
      if (x0 === null || e.pointerId !== id) return;
      dx = e.clientX - x0; dy = e.clientY - y0;
      if (Math.abs(dx) > 8 && !fc.hasPointerCapture(id)) fc.setPointerCapture(id);
      if (Math.abs(dx) > 8) paint();
    });
    const end = e => {
      if (x0 === null || e.pointerId !== id) return;
      x0 = null;
      fc.classList.remove('dragging');
      if (e.type === 'pointerup' && Math.abs(dx) > 90) return decide(dx < 0);
      if (e.type === 'pointerup' && Math.abs(dx) < 8 && Math.abs(dy) < 8) flip();
      dx = 0; paint();
    };
    fc.addEventListener('dragstart', e => e.preventDefault());
    fc.addEventListener('pointerup', end);
    fc.addEventListener('pointercancel', end);
  }

  function decide(ok) {
    if (st.busy) return;
    st.busy = true;
    const row = st.queue.shift();
    if (ok) st.mastered++;
    else {
      st.again.push(row);
      st.misses.set(row._id, (st.misses.get(row._id) || 0) + 1);
    }
    const fc = $('#fc', el);
    fc.classList.remove('dragging');
    $(`.fc-stamp.${ok ? 'yes' : 'no'}`, fc).style.opacity = 1;
    fc.classList.add(ok ? 'out-left' : 'out-right');
    setTimeout(next, 260);
  }

  function next() {
    if (!st.queue.length) {
      if (!st.again.length) return finish(false);
      st.round++;
      st.queue = shuffle(st.again);
      st.again = [];
      toast(`Tour ${st.round} : ${st.queue.length} carte${st.queue.length > 1 ? 's' : ''} à revoir`);
    }
    render();
  }

  function finish(stopped) {
    clearKeys();
    const lbl = k => col(k)?.label || k;
    const firstTry = st.total - st.misses.size;
    const complete = st.mastered === st.total;
    if (complete) {
      history.add({
        listId: list.id, listTitle: list.title, mode: 'cartes', review: false,
        show: cfg.show.map(lbl), find: cfg.find.map(lbl),
        score: firstTry, total: st.total, seconds: Math.round((Date.now() - st.start) / 1000),
      });
    }
    const missedRows = rows.filter(r => st.misses.has(r._id))
      .sort((a, b) => st.misses.get(b._id) - st.misses.get(a._id));
    const pct = Math.round(firstTry / st.total * 100);
    el.innerHTML = `<section class="result">
      <h1>${complete ? 'Tout est maîtrisé 🎉' : `${st.mastered} / ${st.total} maîtrisées`}</h1>
      ${complete ? `<div class="ring" style="--p:${pct}"><span>${pct} %</span></div>
        <p>${firstTry} / ${st.total} du premier coup · ${st.round} tour${st.round > 1 ? 's' : ''}</p>` : ''}
      <p class="muted">${esc(list.title)} · cartes mémoire</p>
      <div class="actions center">
        <button class="btn primary" id="again">Recommencer</button>
        ${missedRows.length ? `<button class="btn" id="retry">Revoir les ${missedRows.length} difficile${missedRows.length > 1 ? 's' : ''}</button>` : ''}
        <a class="btn ghost" href="#/liste/${encodeURIComponent(list.id)}">Changer les réglages</a>
      </div>
      ${missedRows.length ? `<h2>Les plus difficiles</h2>
        <div class="cards">${missedRows.map(r => cardHTML(list, r, cfg.find)).join('')}</div>` : ''}
    </section>`;
    $('#again', el).onclick = () => startFlashcards(el, list, cfg, rows);
    const retry = $('#retry', el);
    if (retry) retry.onclick = () => startFlashcards(el, list, cfg, missedRows);
    window.scrollTo({ top: 0 });
  }

  render();
  window.scrollTo({ top: 0 });
}

// ======================= Révision espacée =======================

export async function renderReview(el, onlyList = null) {
  const due = progress.due(onlyList);
  const pendingAll = progress.pending(onlyList);
  const index = await loadIndex();
  const byList = {};
  for (const d of due) (byList[d.listId] ||= []).push(d);
  const title = id => index.find(l => l.id === id)?.title || id;
  const ids = Object.keys(byList).filter(id => index.some(l => l.id === id));

  el.innerHTML = `<section>
    <div class="page-head"><h1>Révision</h1>
      <p class="muted">Les questions ratées reviennent ici : tout de suite, puis après 1, 3, 7 et 16 jours si vous répondez juste. Après cinq bonnes réponses d’affilée, la fiche est considérée comme acquise.</p></div>
    ${ids.length ? `<div class="list-grid">${ids.map(id => `
      <div class="list-card">
        <h3>${esc(title(id))}</h3>
        <p class="muted">${byList[id].length} question${byList[id].length > 1 ? 's' : ''} à revoir aujourd’hui</p>
        <div class="actions"><button class="btn primary" data-go="${esc(id)}" data-mode="libre">Saisie libre</button>
          <button class="btn" data-go="${esc(id)}" data-mode="qcm">Choix multiple</button></div>
      </div>`).join('')}</div>`
      : `<div class="empty">${pendingAll ? `Rien à revoir aujourd’hui. ${pendingAll} question${pendingAll > 1 ? 's' : ''} en attente pour les prochains jours.` : 'Aucune erreur à revoir pour l’instant. Les questions ratées apparaîtront ici.'}</div>`}
  </section>`;

  $$('[data-go]', el).forEach(b => b.onclick = async () => {
    const list = await loadList(b.dataset.go);
    const items = byList[b.dataset.go];
    const groups = new Map();
    const def = defaultConfig(list);
    for (const it of items) {
      const row = list.rows.find(r => r._id === it.rowId);
      if (!row || !list.columns.some(c => c.key === it.col)) continue;
      const show = (it.show || def.show).filter(k => k !== it.col);
      const gk = it.rowId + '|' + show.join(',');
      if (!groups.has(gk)) groups.set(gk, { kind: 'q', row, show, find: [] });
      groups.get(gk).find.push(it.col);
    }
    const qs = shuffle([...groups.values()]);
    if (!qs.length) { toast('Ces fiches n’existent plus dans la liste', 'err'); return; }
    startSession(el, list, { mode: b.dataset.mode, show: [], find: [], filters: {} }, { questions: qs, review: true });
  });
}

// ======================= Défis =======================

const MODES = { qcm: 'Choix multiple', libre: 'Saisie libre', chrono: 'Ordre', cartes: 'Cartes mémoire' };

export function exerciseLabel(list, cfg) {
  const lbl = k => list.columns.find(c => c.key === k)?.label || k;
  if (cfg.mode === 'chrono') return `Ordre · ${lbl(cfg.orderCol)}`;
  if (!cfg.find?.length) return MODES[cfg.mode] || cfg.mode;
  return `${MODES[cfg.mode] || cfg.mode} · ${(cfg.show || []).map(lbl).join(' + ') || '…'} → ${cfg.find.map(lbl).join(' + ')}`;
}

// Fige les questions (et les propositions des choix multiples) pour que tout le monde ait les mêmes.
export async function makeChallenge(list, cfg, qs) {
  const pool = applyFilters(list, cfg.filters || {});
  const out = qs.map(q => {
    if (q.kind === 'chrono') return { k: 'chrono', r: q.rows.map(r => r._id), o: q.orderCol, s: q.show };
    const c = {};
    for (const key of q.find) {
      const col = list.columns.find(x => x.key === key);
      if (!col) continue;
      if (cfg.mode === 'qcm' || isMedia(col)) {
        const choices = q.choices?.[key] || buildChoices(list, col, q.row, pool);
        c[key] = choices.map(o => ({ r: o.rowId, ok: o.ok }));
      }
    }
    return { k: 'q', r: q.row._id, s: q.show, f: q.find, c };
  });
  const isPrivate = /^(perso|brouillon|defi):/.test(list.id);
  const snapshot = isPrivate ? {
    title: list.title, description: list.description, columns: list.columns,
    rows: list.rows.map(({ _id, ...r }) => ({ ...r, id: _id })),
  } : null;
  return createChallenge({
    title: `${list.title} · ${exerciseLabel(list, cfg)}`,
    listId: list.id.startsWith('defi:') ? list.id : list.id,
    snapshot, config: { mode: cfg.mode, show: cfg.show, find: cfg.find, orderCol: cfg.orderCol }, questions: out,
  });
}

export function challengeQuestions(list, questions) {
  const byId = new Map(list.rows.map(r => [r._id, r]));
  return questions.map(q => {
    if (q.k === 'chrono') {
      const rows = q.r.map(id => byId.get(id)).filter(Boolean);
      return rows.length >= 2 ? { kind: 'chrono', rows, orderCol: q.o, show: q.s || [] } : null;
    }
    const row = byId.get(q.r);
    if (!row) return null;
    const fixedChoices = {};
    for (const [key, opts] of Object.entries(q.c || {})) {
      fixedChoices[key] = opts.filter(o => byId.has(o.r)).map(o => ({ v: byId.get(o.r)[key], ok: o.ok, rowId: o.r }));
    }
    return { kind: 'q', row, show: q.s || [], find: q.f || [], fixedChoices };
  }).filter(Boolean);
}

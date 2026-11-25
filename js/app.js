// Routeur et pages simples : accueil, historique.
import { $, $$, esc, formatWhen, toast, safeUrl } from './util.js';
import { loadIndex } from './data.js';
import { progress, history, favorites } from './store.js';
import { renderSetup, renderReview, clearKeys, startSession } from './quiz.js';
import { renderEditorHome, renderEditor, renderConnectLink } from './editor.js';
import { loadList } from './data.js';
import { cloudEnabled, initCloud, currentUser, onUserChange } from './cloud.js';
import { renderAccount, renderLeaderboard, renderChallenge, renderAdmin } from './social.js';
import { loadCategories, childrenOf, pathOf, descendants, categoryOfList, enableExplorer } from './categories.js';

const app = $('#app');

const routes = [
  [/^#?\/?$/, el => renderHome(el)],
  [/^#\/c\/([\w-]+)$/, (el, id) => renderHome(el, id)],
  [/^#\/liste\/(.+)$/, (el, id) => renderSetup(el, decodeURIComponent(id))],
  [/^#\/favori\/(.+)$/, renderFavorite],
  [/^#\/revision(?:\/(.+))?$/, (el, id) => renderReview(el, id ? decodeURIComponent(id) : null)],
  [/^#\/historique$/, renderHistory],
  [/^#\/editeur$/, renderEditorHome],
  [/^#\/connexion\/([^/]+)\/(.+)$/, renderConnectLink],
  [/^#\/editeur\/(.+)$/, (el, id) => renderEditor(el, decodeURIComponent(id))],
  [/^#\/compte$/, renderAccount],
  [/^#\/admin$/, renderAdmin],
  [/^#\/classement(?:\/(\w+))?$/, (el, tab) => renderLeaderboard(el, tab || 'general')],
  [/^#\/defi\/([\w-]+)$/, renderChallenge],
];

async function route() {
  clearKeys();
  const hash = location.hash || '#/';
  $$('nav a').forEach(a => a.classList.toggle('on', hash.startsWith(a.getAttribute('href')) && a.getAttribute('href') !== '#/' || hash === a.getAttribute('href')));
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      try { await fn(app, ...m.slice(1)); }
      catch (e) {
        console.error(e);
        app.innerHTML = `<div class="empty">Oups : ${esc(e.message)}<br><a href="#/">Retour à l’accueil</a></div>`;
      }
      updateBadge();
      return;
    }
  }
  location.hash = '#/';
}

function updateBadge() {
  const n = progress.due().length;
  const b = $('#due-badge');
  b.textContent = n;
  b.hidden = !n;
}

const card = (l, admin = false) => `
        <a class="list-card" href="#/liste/${encodeURIComponent(l.id)}" ${admin ? `draggable="true" data-list="${esc(l.id)}"` : ''}>
          ${admin ? `<button class="more" data-menu-list="${esc(l.id)}" title="Options" aria-label="Options">⋯</button>` : ''}
          ${safeUrl(l.cover) ? `<img src="${/^https?:/.test(l.cover) ? '' : 'lists/'}${esc(safeUrl(l.cover))}" alt="" loading="lazy">` : ''}
          <h3>${esc(l.title)} ${l.draft ? '<span class="badge-draft">brouillon</span>' : ''}${l.mine ? '<span class="badge-draft">perso</span>' : ''}</h3>
          ${l.description ? `<p class="muted">${esc(l.description)}</p>` : ''}
          <p class="small muted">${l.count} fiches${l.columns ? ' · ' + l.columns.map(esc).join(', ') : ''}</p>
        </a>`;

async function renderHome(el, catId = null) {
  const all = await loadIndex();
  let t = { cats: [], byId: new Map(), listCat: new Map() };
  let catsReady = true;
  try { t = await loadCategories(); } catch (e) { catsReady = false; }
  if (catId && !t.byId.has(catId)) catId = null;
  const admin = !!currentUser()?.isAdmin && catsReady;
  const isPublic = l => !l.draft && !l.mine;
  const inTree = id => {
    const set = descendants(t, id);
    return all.filter(l => isPublic(l) && set.has(categoryOfList(t, l.id))).length;
  };
  const subcats = childrenOf(t, catId);
  const here = all.filter(l => isPublic(l) && categoryOfList(t, l.id) === catId);
  const personal = catId ? [] : all.filter(l => !isPublic(l));
  const folderCard = c => {
    const n = inTree(c.id), k = childrenOf(t, c.id).length;
    return `<a class="list-card folder" href="#/c/${c.id}" data-drop="${c.id}" ${admin ? `draggable="true" data-folder="${c.id}"` : ''}>
      ${admin ? `<button class="more" data-menu-folder="${c.id}" title="Options" aria-label="Options">⋯</button>` : ''}
      <h3>📁 ${esc(c.name)}</h3>
      <p class="small muted">${n} liste${n > 1 ? 's' : ''}${k ? ` · ${k} dossier${k > 1 ? 's' : ''}` : ''}</p></a>`;
  };
  const toolbar = currentUser()?.isAdmin && !catsReady
    ? '<div class="banner">📁 Les dossiers ne sont pas encore activés : collez le bloc SQL des catégories dans Supabase (SQL Editor → Run), puis rechargez la page.</div>'
    : admin ? `<div class="explorer-bar"><button class="btn small" id="new-folder">+ Nouveau dossier</button>
    <span class="muted small">Glissez une liste sur un dossier pour l’y ranger, ou utilisez ⋯</span></div>` : '';
  const content = `
      ${toolbar}
      ${subcats.length || here.length ? `<div class="list-grid">${subcats.map(folderCard).join('')}${here.map(l => card(l, admin)).join('')}</div>` : ''}`;

  if (catId) {
    el.innerHTML = `<section>
      <nav class="crumbs"><a href="#/" data-drop="">Accueil</a>${pathOf(t, catId).map((c, i, a) => i === a.length - 1 ? ` › <b>${esc(c.name)}</b>` : ` › <a href="#/c/${c.id}" data-drop="${c.id}">${esc(c.name)}</a>`).join('')}</nav>
      ${content}
      ${!subcats.length && !here.length ? '<div class="empty">Ce dossier est vide.</div>' : ''}
    </section>`;
  } else {
    const favs = favorites.all();
    const due = progress.due();
    el.innerHTML = `
    <section>
      ${cloudEnabled && !currentUser() ? '<a class="banner soft" href="#/compte">👋 Créez un compte pour vous mesurer à vos potes (classement, défis) et garder vos listes sur tous vos appareils.</a>' : ''}
      ${due.length ? `<a class="banner" href="#/revision">🔁 ${due.length} question${due.length > 1 ? 's' : ''} à revoir aujourd’hui</a>` : ''}
      ${favs.length ? `<h2>Mes combinaisons</h2>
        <div class="fav-list">${favs.map(f => `
          <div class="fav"><a href="#/favori/${f.id}" class="fav-go">▶ ${esc(f.name)}</a>
          <button class="icon-btn" data-del="${f.id}" title="Supprimer">✕</button></div>`).join('')}</div>` : ''}
      <h2>Listes</h2>
      ${content}
      ${!subcats.length && !here.length && !personal.length ? '<div class="empty">Aucune liste trouvée. Créez-en une dans l’<a href="#/editeur">éditeur</a>.</div>' : ''}
      ${personal.length ? `<h2>Mes listes</h2><div class="list-grid">${personal.map(l => card(l)).join('')}</div>` : ''}
    </section>`;
    $$('[data-del]', el).forEach(b => b.onclick = () => { favorites.remove(b.dataset.del); renderHome(el); });
  }
  if (admin) enableExplorer(el, t, catId, all.filter(isPublic), () => renderHome(el, catId));
}

async function renderFavorite(el, id) {
  const f = favorites.get(id);
  if (!f) { location.hash = '#/'; return; }
  const list = await loadList(f.listId);
  startSession(el, list, f.cfg);
}

function renderHistory(el) {
  const all = history.all();
  const byList = {};
  for (const h of all) {
    const s = (byList[h.listTitle] ||= { n: 0, score: 0, total: 0, best: 0 });
    s.n++; s.score += h.score; s.total += h.total;
    s.best = Math.max(s.best, h.total ? h.score / h.total : 0);
  }
  const modes = { qcm: 'Choix multiple', libre: 'Saisie libre', chrono: 'Ordre', cartes: 'Cartes mémoire' };
  el.innerHTML = `<section>
    <div class="page-head"><h1>Historique</h1></div>
    ${all.length ? `
      <div class="stats">${Object.entries(byList).map(([t, s]) => `
        <div class="stat"><span class="lbl">${esc(t)}</span><b>${Math.round(s.score / s.total * 100)} %</b>
        <span class="small muted">${s.n} séance${s.n > 1 ? 's' : ''} · meilleur ${Math.round(s.best * 100)} %</span></div>`).join('')}</div>
      <div class="spark">${all.slice(0, 40).reverse().map(h => `<span title="${esc(h.listTitle)} : ${h.score}/${h.total}" style="height:${h.total ? Math.max(4, h.score / h.total * 100) : 4}%"></span>`).join('')}</div>
      <div class="table-wrap"><table class="hist">
        <thead><tr><th>Date</th><th>Liste</th><th>Exercice</th><th>Score</th></tr></thead>
        <tbody>${all.map(h => `<tr>
          <td>${formatWhen(h.at)}</td><td>${esc(h.listTitle)}${h.review ? ' <span class="tag">révision</span>' : ''}</td>
          <td class="small">${esc(modes[h.mode] || h.mode)}${h.find?.length ? ' · ' + esc((h.show || []).join(' + ') || '…') + ' → ' + esc(h.find.join(' + ')) : ''}</td>
          <td><b>${h.score}/${h.total}</b> <span class="muted small">${h.total ? Math.round(h.score / h.total * 100) : 0} %</span></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="actions"><button class="btn ghost" id="clear">Effacer l’historique</button></div>`
    : '<div class="empty">Pas encore de séance. Lancez un entraînement depuis l’accueil.</div>'}
  </section>`;
  const c = $('#clear', el);
  if (c) c.onclick = () => {
    if (c.dataset.confirm) { history.clear(); toast('Historique effacé'); renderHistory(el); }
    else { c.dataset.confirm = '1'; c.textContent = 'Cliquer encore pour confirmer'; }
  };
}

function updateAccount() {
  const a = $('#account-link');
  if (!a) return;
  a.hidden = !cloudEnabled;
  $('#rank-link').hidden = !cloudEnabled;
  $('#admin-link').hidden = !currentUser()?.isAdmin;
  a.textContent = currentUser() ? '👤 ' + currentUser().username : 'Se connecter';
}
onUserChange(updateAccount);

window.addEventListener('hashchange', route);
// Un lien vers la page courante (ex. « Changer les réglages » pendant un quiz) recharge la vue.
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (a && a.getAttribute('href') === (location.hash || '#/')) { e.preventDefault(); route(); }
});
initCloud().catch(e => console.warn('Comptes indisponibles', e)).finally(() => { updateAccount(); route(); });

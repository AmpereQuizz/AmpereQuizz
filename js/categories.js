// Catégories (arborescence) pour ranger les listes publiques.
import { $, $$, esc, toast } from './util.js';
import { categoriesData, saveCategory, deleteCategory, setListCategory } from './cloud.js';

let cache = null;

export async function loadCategories(force = false) {
  if (!cache || force) {
    const { cats, links } = await categoriesData();
    cats.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'));
    cache = { cats, byId: new Map(cats.map(c => [c.id, c])), listCat: new Map(links.map(l => [l.list_id, l.category_id])) };
  }
  return cache;
}

export const childrenOf = (t, parent) => t.cats.filter(c => (c.parent || null) === (parent || null));

export function pathOf(t, id) {
  const out = [];
  const seen = new Set();
  for (let c = t.byId.get(id); c && !seen.has(c.id); c = t.byId.get(c.parent)) { seen.add(c.id); out.unshift(c); }
  return out;
}

export function descendants(t, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of t.cats) if (c.parent && out.has(c.parent) && !out.has(c.id)) { out.add(c.id); grew = true; }
  }
  return out;
}

// Catégorie d'une liste, en ignorant un rangement vers une catégorie supprimée.
export const categoryOfList = (t, listId) => (t.byId.has(t.listCat.get(listId)) ? t.listCat.get(listId) : null);

// ======================= Explorateur (admins, sur l'accueil) =======================

// Petite fenêtre : texte à saisir, ou choix dans une liste. Renvoie la valeur, ou null si annulé.
function dialog({ title, value = null, choices = null, ok = 'OK', danger = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = `<form class="modal" role="dialog" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      ${value !== null ? `<input name="v" value="${esc(value)}" maxlength="60" required>` : ''}
      ${choices ? `<div class="modal-choices">${choices.map((c, i) => `<label><input type="radio" name="c" value="${i}" ${c.current ? 'checked' : ''}> <span style="padding-left:${c.depth * 1.1}rem">${esc(c.label)}</span></label>`).join('')}</div>` : ''}
      <div class="actions"><button type="button" class="btn ghost" data-x>Annuler</button><button class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div>
    </form>`;
    document.body.appendChild(wrap);
    const done = v => { wrap.remove(); document.removeEventListener('keydown', esc_); resolve(v); };
    const esc_ = e => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', esc_);
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-x]')) done(null); });
    const form = wrap.querySelector('form');
    form.onsubmit = e => {
      e.preventDefault();
      if (value !== null) return done(form.v.value.trim() || null);
      if (choices) { const r = form.querySelector('input[name=c]:checked'); return done(r ? choices[+r.value].value : null); }
      done(true);
    };
    (form.querySelector('input[name=v]') || form.querySelector('input:checked') || form.querySelector('button.primary, button.danger')).focus();
    form.querySelector('input[name=v]')?.select();
  });
}

function menu(anchor, items) {
  document.querySelector('.ctx-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'ctx-menu';
  m.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = `${window.scrollY + r.bottom + 4}px`;
  m.style.left = `${Math.max(8, Math.min(window.scrollX + r.right - m.offsetWidth, document.documentElement.clientWidth - m.offsetWidth - 8))}px`;
  const close = () => { m.remove(); document.removeEventListener('click', outside, true); };
  const outside = e => { if (!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('click', outside, true));
  m.onclick = e => { const b = e.target.closest('button'); if (b) { close(); items[+b.dataset.i].run(); } };
}

// Choix d'un dossier de destination (arborescence complète), sans le dossier lui-même ni ses sous-dossiers.
function folderChoices(t, current, exclude = new Set()) {
  const out = [{ label: '🏠 Accueil', value: '', depth: 0, current: !current }];
  const walk = (parent, depth) => childrenOf(t, parent).forEach(c => {
    if (exclude.has(c.id)) return;
    out.push({ label: '📁 ' + c.name, value: c.id, depth, current: c.id === current });
    walk(c.id, depth + 1);
  });
  walk(null, 1);
  return out;
}

export function enableExplorer(el, t, catId, publicLists, refresh) {
  const act = async (fn, msg) => {
    try { await fn(); await loadCategories(true); if (msg) toast(msg); refresh(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const newFolder = async parent => {
    const name = await dialog({ title: 'Nouveau dossier', value: '', ok: 'Créer' });
    if (name) act(() => saveCategory({ name, parent: parent || null, position: t.cats.length }), 'Dossier créé');
  };
  const moveList = async id => {
    const dest = await dialog({ title: 'Déplacer la liste vers…', choices: folderChoices(t, categoryOfList(t, id)), ok: 'Déplacer' });
    if (dest !== null) act(() => setListCategory(id, dest || null), 'Liste déplacée');
  };
  const moveFolder = async id => {
    const c = t.byId.get(id);
    const dest = await dialog({ title: `Déplacer « ${c.name} » vers…`, choices: folderChoices(t, c.parent, descendants(t, id)), ok: 'Déplacer' });
    if (dest !== null) act(() => saveCategory({ id, parent: dest || null }), 'Dossier déplacé');
  };
  $('#new-folder', el)?.addEventListener('click', () => newFolder(catId));

  $$('[data-menu-folder]', el).forEach(b => b.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const id = b.dataset.menuFolder, c = t.byId.get(id);
    menu(b, [
      { label: 'Ouvrir', run: () => { location.hash = '#/c/' + id; } },
      { label: 'Nouveau dossier dedans', run: () => newFolder(id) },
      { label: 'Renommer', run: async () => { const n = await dialog({ title: 'Renommer le dossier', value: c.name, ok: 'Renommer' }); if (n) act(() => saveCategory({ id, name: n }), 'Dossier renommé'); } },
      { label: 'Déplacer vers…', run: () => moveFolder(id) },
      { label: 'Supprimer', danger: true, run: async () => {
        const ok = await dialog({ title: `Supprimer « ${c.name} » ? Ses listes et sous-dossiers remontent d’un niveau.`, ok: 'Supprimer', danger: true });
        if (!ok) return;
        // Les listes rangées ici remontent dans le dossier parent (ou à l'accueil).
        const lists = [...t.listCat].filter(([, cid]) => cid === id).map(([lid]) => lid);
        const kids = childrenOf(t, id).map(k => k.id);
        act(async () => {
          for (const lid of lists) await setListCategory(lid, c.parent || null);
          for (const kid of kids) await saveCategory({ id: kid, parent: c.parent || null });
          await deleteCategory(id);
        }, 'Dossier supprimé');
      } },
    ]);
  }));
  $$('[data-menu-list]', el).forEach(b => b.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const id = b.dataset.menuList;
    menu(b, [
      { label: 'Ouvrir', run: () => { location.hash = '#/liste/' + encodeURIComponent(id); } },
      { label: 'Déplacer vers…', run: () => moveList(id) },
      ...(categoryOfList(t, id) ? [{ label: 'Sortir du dossier', run: () => act(() => setListCategory(id, t.byId.get(categoryOfList(t, id))?.parent || null), 'Liste déplacée') }] : []),
      { label: 'Modifier dans l’éditeur', run: () => { location.hash = '#/editeur'; } },
    ]);
  }));

  // Glisser-déposer : une liste ou un dossier sur un dossier (ou sur le fil d'Ariane).
  let dragged = null;
  $$('[data-list][draggable], [data-folder][draggable]', el).forEach(n => {
    n.addEventListener('dragstart', e => {
      dragged = n.dataset.list ? { list: n.dataset.list } : { folder: n.dataset.folder };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'quizz');
      n.classList.add('dragging');
    });
    n.addEventListener('dragend', () => { n.classList.remove('dragging'); dragged = null; });
  });
  $$('[data-drop]', el).forEach(z => {
    const target = z.dataset.drop || null;
    const allowed = () => dragged && (dragged.list || (dragged.folder !== target && !(target && descendants(t, dragged.folder).has(target))));
    z.addEventListener('dragover', e => { if (allowed()) { e.preventDefault(); z.classList.add('drop-on'); } });
    z.addEventListener('dragleave', () => z.classList.remove('drop-on'));
    z.addEventListener('drop', e => {
      e.preventDefault();
      z.classList.remove('drop-on');
      if (!allowed()) return;
      const d = dragged;
      if (d.list) act(() => setListCategory(d.list, target), 'Liste rangée');
      else act(() => saveCategory({ id: d.folder, parent: target }), 'Dossier déplacé');
    });
  });
}

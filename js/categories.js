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

const label = (t, c) => pathOf(t, c.id).map(x => x.name).join(' › ');

function options(t, selected, exclude = new Set(), none = '— Aucune —') {
  const opts = [...t.cats].filter(c => !exclude.has(c.id)).sort((a, b) => label(t, a).localeCompare(label(t, b), 'fr'));
  return `<option value="">${none}</option>` + opts.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(label(t, c))}</option>`).join('');
}

// Panneau d'administration des catégories (dans l'onglet Admin).
export async function renderCategoryAdmin(box, publicLists) {
  let t;
  try { t = await loadCategories(true); }
  catch (e) {
    box.innerHTML = `<div class="panel"><h2>Catégories</h2><p class="hint">Indisponible : ${esc(e.message)}. Il faut d’abord coller supabase/categories.sql dans Supabase.</p></div>`;
    return;
  }
  const tree = parent => {
    const kids = childrenOf(t, parent);
    if (!kids.length) return '';
    return `<ul class="cat-tree">${kids.map(c => `<li data-id="${c.id}">
      <div class="cat-row">
        <input class="cat-name" value="${esc(c.name)}" aria-label="Nom">
        <select class="cat-parent" aria-label="Catégorie parente">${options(t, c.parent, descendants(t, c.id), '(au premier niveau)')}</select>
        <button class="icon-btn cat-del" title="Supprimer">✕</button>
      </div>${tree(c.id)}</li>`).join('')}</ul>`;
  };
  box.innerHTML = `
    <div class="panel">
      <h2>Catégories</h2>
      <p class="hint">Créez des catégories et des sous-catégories (ex. Nature › Oiseaux), puis rangez les listes dedans. Supprimer une catégorie remonte ses sous-catégories d’un niveau ; ses listes redeviennent « sans catégorie ».</p>
      ${t.cats.length ? tree(null) : '<p class="muted">Aucune catégorie.</p>'}
      <form class="inline-form cat-new"><input name="name" placeholder="Nouvelle catégorie" maxlength="60" required>
        <select name="parent">${options(t, null, new Set(), '(au premier niveau)')}</select>
        <button class="btn primary">Ajouter</button></form>
    </div>
    <div class="panel">
      <h2>Ranger les listes</h2>
      ${publicLists.length ? `<div class="table-wrap"><table class="list-cats"><tbody>${publicLists.map(l => `
        <tr><td>${esc(l.title)}</td><td><select class="list-cat" data-list="${esc(l.id)}">${options(t, categoryOfList(t, l.id), new Set(), '— Sans catégorie —')}</select></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Aucune liste publique.</p>'}
    </div>`;

  const run = async (fn, ok) => {
    try { await fn(); if (ok) toast(ok); renderCategoryAdmin(box, publicLists); }
    catch (e) { toast(e.message, 'err'); renderCategoryAdmin(box, publicLists); }
  };
  $('.cat-new', box).onsubmit = e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (name) run(() => saveCategory({ name, parent: e.target.parent.value || null, position: t.cats.length }), 'Catégorie ajoutée');
  };
  $$('.cat-tree li', box).forEach(li => {
    const id = li.dataset.id;
    const row = $(':scope > .cat-row', li);
    const name = $('.cat-name', row);
    name.onchange = () => name.value.trim() && run(() => saveCategory({ id, name: name.value.trim() }), 'Renommée');
    $('.cat-parent', row).onchange = e => run(() => saveCategory({ id, parent: e.target.value || null }), 'Déplacée');
    const del = $('.cat-del', row);
    del.onclick = () => {
      if (!del.dataset.confirm) { del.dataset.confirm = 1; del.textContent = 'Supprimer ?'; return; }
      run(() => deleteCategory(id), 'Catégorie supprimée');
    };
  });
  $$('.list-cat', box).forEach(s => s.onchange = () => run(() => setListCategory(s.dataset.list, s.value || null), 'Liste rangée'));
}

// Tout ce qui est propre à l'utilisateur vit dans le localStorage du navigateur.

const PREFIX = 'quizz.';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Stockage impossible', e);
    return false;
  }
}

// ---------- Répétition espacée (boîtes de Leitner) ----------
// Une entrée par (liste, ligne, colonne à trouver).
// box 0 : jamais ratée. box 1..5 : à revoir, intervalle croissant. box 6 : maîtrisée.
const INTERVALS_DAYS = [0, 0, 1, 3, 7, 16];
const DAY = 86400000;

export const progress = {
  all() { return read('progress', {}); },
  key(listId, rowId, col) { return `${listId}|${rowId}|${col}`; },
  record(listId, rowId, col, correct, show) {
    const all = this.all();
    const k = this.key(listId, rowId, col);
    const e = all[k] || { box: 0, seen: 0, wrong: 0 };
    e.seen++;
    e.last = Date.now();
    if (show) e.show = show;
    if (!correct) {
      e.wrong++;
      e.box = 1;
      e.due = Date.now();
    } else if (e.box > 0) {
      e.box++;
      e.due = Date.now() + (INTERVALS_DAYS[e.box] ?? 0) * DAY;
    }
    all[k] = e;
    write('progress', all);
    return e;
  },
  // Éléments ratés dont la révision est due.
  due(listId = null, now = Date.now()) {
    const out = [];
    for (const [k, e] of Object.entries(this.all())) {
      const [l, rowId, col] = k.split('|');
      if (listId && l !== listId) continue;
      if (e.box >= 1 && e.box <= 5 && (e.due ?? 0) <= now) out.push({ listId: l, rowId, col, ...e });
    }
    return out;
  },
  pending(listId = null) {
    return Object.entries(this.all()).filter(([k, e]) =>
      (!listId || k.startsWith(listId + '|')) && e.box >= 1 && e.box <= 5).length;
  },
  clear(listId) {
    if (!listId) return write('progress', {});
    const all = this.all();
    for (const k of Object.keys(all)) if (k.startsWith(listId + '|')) delete all[k];
    write('progress', all);
  },
};

// ---------- Historique des scores ----------

export const history = {
  all() { return read('history', []); },
  add(entry) {
    const all = this.all();
    all.unshift({ ...entry, at: Date.now() });
    write('history', all.slice(0, 1000));
  },
  clear() { write('history', []); },
};

// ---------- Combinaisons enregistrées ----------

export const favorites = {
  all() { return read('favorites', []); },
  add(fav) {
    const all = this.all();
    fav.id = 'f' + Date.now().toString(36);
    all.push(fav);
    write('favorites', all);
    return fav;
  },
  remove(id) { write('favorites', this.all().filter(f => f.id !== id)); },
  get(id) { return this.all().find(f => f.id === id); },
};

// ---------- Derniers réglages par liste ----------

export const lastConfig = {
  get(listId) { return read('config.' + listId, null); },
  set(listId, cfg) { write('config.' + listId, cfg); },
};

// ---------- Brouillons de l'éditeur ----------

export const drafts = {
  all() { return read('drafts', {}); },
  get(id) { return this.all()[id]; },
  save(list) {
    const all = this.all();
    all[list._draftId] = list;
    return write('drafts', all);
  },
  remove(draftId) {
    const all = this.all();
    delete all[draftId];
    write('drafts', all);
  },
};

export const settings = {
  get() { return read('settings', {}); },
  set(patch) { write('settings', { ...this.get(), ...patch }); },
};

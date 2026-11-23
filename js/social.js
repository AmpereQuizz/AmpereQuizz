// Pages « Compte », « Classement » et « Défi ».
import { $, $$, esc, formatWhen, toast } from './util.js';
import { loadList } from './data.js';
import { startSession, challengeQuestions } from './quiz.js';
import {
  cloudEnabled, currentUser, signIn, signUp, signOut, changePassword, USERNAME_RE,
  leaderboard, listLeaderboard, playedLists, recentScores, recentChallenges, getChallenge, challengeResults,
  allUsers, setAdmin,
} from './cloud.js';

const disabledHTML = '<div class="empty">Les comptes ne sont pas encore activés sur ce site.</div>';

function returnTo() {
  try { return sessionStorage.getItem('quizz.returnTo') || '#/'; } catch { return '#/'; }
}
export function askLogin(back) {
  try { sessionStorage.setItem('quizz.returnTo', back); } catch {}
  location.hash = '#/compte';
}

// ======================= Compte =======================

export function renderAccount(el) {
  if (!cloudEnabled) { el.innerHTML = disabledHTML; return; }
  const me = currentUser();
  if (me) {
    el.innerHTML = `<section>
      <div class="page-head"><h1>Mon compte</h1><p>Connecté en tant que <b>${esc(me.username)}</b>.</p></div>
      <div class="panel">
        <h2>Mes listes</h2>
        <p class="hint">Vos listes personnelles sont privées et vous suivent sur tous vos appareils. Créez-les dans l’<a href="#/editeur">éditeur</a>.</p>
      </div>
      <div class="panel">
        <h2>Changer de mot de passe</h2>
        <form class="inline-form" id="pw"><input type="password" name="pw" placeholder="Nouveau mot de passe" autocomplete="new-password" minlength="6" required>
          <button class="btn">Changer</button></form>
      </div>
      <div class="actions"><button class="btn ghost" id="out">Se déconnecter</button></div>
    </section>`;
    $('#out', el).onclick = async () => { await signOut(); location.hash = '#/'; };
    $('#pw', el).onsubmit = async e => {
      e.preventDefault();
      try { await changePassword(e.target.pw.value); toast('Mot de passe changé'); e.target.reset(); }
      catch (err) { toast(err.message, 'err'); }
    };
    return;
  }
  let mode = 'in';
  const draw = () => {
    el.innerHTML = `<section class="auth">
      <div class="page-head"><h1>${mode === 'in' ? 'Se connecter' : 'Créer un compte'}</h1>
        <p class="muted">Un compte permet d’apparaître au classement, de lancer des défis à vos potes et de garder vos listes perso sur tous vos appareils.</p></div>
      <div class="seg" id="tabs"><button data-v="in" class="${mode === 'in' ? 'on' : ''}">J’ai un compte</button><button data-v="up" class="${mode === 'up' ? 'on' : ''}">Créer un compte</button></div>
      <form class="panel auth-form" id="f">
        <label>Nom d’utilisateur<input name="u" autocomplete="username" required autocapitalize="off" spellcheck="false"></label>
        <label>Mot de passe<input name="p" type="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" required></label>
        ${mode === 'up' ? '<label>Mot de passe (encore)<input name="p2" type="password" autocomplete="new-password" required></label><p class="hint">3 à 20 caractères : lettres, chiffres, . _ -. Mot de passe : 6 caractères minimum. Pas d’adresse e-mail : notez bien votre mot de passe.</p>' : ''}
        <button class="btn primary">${mode === 'in' ? 'Se connecter' : 'Créer mon compte'}</button>
        <p class="err" id="msg"></p>
      </form></section>`;
    $('#tabs', el).onclick = e => { const v = e.target.closest('button')?.dataset.v; if (v) { mode = v; draw(); } };
    $('#f', el).onsubmit = async e => {
      e.preventDefault();
      const f = e.target, msg = $('#msg', el), btn = $('button.primary', f);
      const u = f.u.value.trim(), p = f.p.value;
      if (mode === 'up' && !USERNAME_RE.test(u)) { msg.textContent = 'Nom d’utilisateur : 3 à 20 caractères (lettres, chiffres, . _ -).'; return; }
      if (mode === 'up' && p !== f.p2.value) { msg.textContent = 'Les deux mots de passe sont différents.'; return; }
      btn.disabled = true;
      msg.textContent = '';
      try {
        const me = mode === 'in' ? await signIn(u, p) : await signUp(u, p);
        toast(`Bienvenue ${me.username} !`);
        const back = returnTo();
        try { sessionStorage.removeItem('quizz.returnTo'); } catch {}
        location.hash = back;
      } catch (err) { msg.textContent = err.message; btn.disabled = false; }
    };
    $('[name=u]', el).focus();
  };
  draw();
}

// ======================= Classement =======================

export async function renderLeaderboard(el, tab = 'general') {
  if (!cloudEnabled) { el.innerHTML = disabledHTML; return; }
  const me = currentUser()?.username;
  const tabs = { general: 'Général', listes: 'Par liste', defis: 'Défis', parties: 'Dernières parties' };
  el.innerHTML = `<section>
    <div class="page-head"><h1>Classement</h1></div>
    <div class="seg" id="tabs">${Object.entries(tabs).map(([k, v]) => `<button data-v="${k}" class="${k === tab ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div id="board" class="board"><div class="empty">Chargement…</div></div>
  </section>`;
  $('#tabs', el).onclick = e => { const v = e.target.closest('button')?.dataset.v; if (v) renderLeaderboard(el, v); };
  const board = $('#board', el);
  const medal = i => ['🥇', '🥈', '🥉'][i] || i + 1;
  const mine = u => u === me ? ' class="me"' : '';
  try {
    if (tab === 'general') {
      const rows = await leaderboard();
      board.innerHTML = rows.length ? `<p class="hint">Points = nombre total de bonnes réponses (hors révisions).</p>
        <div class="table-wrap"><table class="rank"><thead><tr><th></th><th>Joueur</th><th>Points</th><th>Réussite</th><th>Parties</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr${mine(r.username)}><td>${medal(i)}</td><td>${esc(r.username)}</td><td><b>${r.points}</b></td><td>${r.pct} %</td><td>${r.sessions}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">Personne n’a encore joué connecté. À vous !</div>';
    } else if (tab === 'listes') {
      const lists = await playedLists();
      if (!lists.length) { board.innerHTML = '<div class="empty">Aucune partie pour l’instant.</div>'; return; }
      board.innerHTML = `<select id="pick">${lists.map(l => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join('')}</select><div id="sub"></div>`;
      const show = async id => {
        const rows = await listLeaderboard(id);
        $('#sub', board).innerHTML = `<div class="table-wrap"><table class="rank"><thead><tr><th></th><th>Joueur</th><th>Meilleure partie</th><th>Moyenne</th><th>Points</th><th>Parties</th></tr></thead>
          <tbody>${rows.map((r, i) => `<tr${mine(r.username)}><td>${medal(i)}</td><td>${esc(r.username)}</td><td><b>${r.best_pct} %</b></td><td>${r.pct} %</td><td>${r.points}</td><td>${r.sessions}</td></tr>`).join('')}</tbody></table></div>`;
      };
      $('#pick', board).onchange = e => show(e.target.value);
      show(lists[0].id);
    } else if (tab === 'defis') {
      const rows = await recentChallenges();
      board.innerHTML = rows.length ? `<div class="fav-list">${rows.map(c => `
        <div class="fav"><a class="fav-go" href="#/defi/${esc(c.id)}">⚔️ ${esc(c.title)} <span class="muted small">· par ${esc(c.profiles?.username || '?')} · ${formatWhen(c.created_at)}</span></a></div>`).join('')}</div>`
        : '<div class="empty">Aucun défi. Lancez-en un depuis une liste : « ⚔️ Créer un défi ».</div>';
    } else {
      const rows = await recentScores();
      board.innerHTML = rows.length ? `<div class="table-wrap"><table class="hist"><thead><tr><th>Quand</th><th>Joueur</th><th>Exercice</th><th>Score</th></tr></thead>
        <tbody>${rows.map(r => `<tr${mine(r.profiles?.username)}><td>${formatWhen(r.created_at)}</td><td>${esc(r.profiles?.username || '?')}</td>
          <td class="small">${esc(r.list_title)}${r.challenge_id ? ' <span class="tag">défi</span>' : ''}<br><span class="muted">${esc(r.exercise || '')}</span></td>
          <td><b>${r.score}/${r.total}</b></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">Aucune partie pour l’instant.</div>';
    }
  } catch (e) {
    board.innerHTML = `<div class="empty">Classement indisponible : ${esc(e.message)}</div>`;
  }
}

// ======================= Défi =======================

export async function renderChallenge(el, id) {
  if (!cloudEnabled) { el.innerHTML = disabledHTML; return; }
  const c = await getChallenge(id);
  if (!c) { el.innerHTML = '<div class="empty">Ce défi n’existe pas (ou plus).</div>'; return; }
  const results = await challengeResults(id);
  const me = currentUser();
  const mineRes = me && results.find(r => r.user_id === me.id);
  const link = `${location.origin}${location.pathname}#/defi/${id}`;
  const fmtTime = s => s == null ? '' : s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`;
  el.innerHTML = `<section>
    <div class="page-head"><a href="#/classement/defis" class="back">← Défis</a>
      <h1>⚔️ ${esc(c.title)}</h1>
      <p class="muted">Lancé par <b>${esc(c.profiles?.username || '?')}</b> · ${c.questions.length} questions · une seule tentative par joueur</p></div>
    <div class="panel share">
      <span>Envoyez ce lien à vos potes :</span>
      <div class="inline-form"><input id="link" value="${esc(link)}" readonly><button class="btn" id="copy">Copier</button></div>
    </div>
    <div class="actions">
      ${!me ? '<button class="btn primary big" id="login">Se connecter pour relever le défi</button>'
        : mineRes ? `<p>Votre score : <b>${mineRes.score} / ${mineRes.total}</b> en ${fmtTime(mineRes.seconds)}.</p>`
        : '<button class="btn primary big" id="play">Relever le défi</button>'}
    </div>
    <h2>Classement du défi</h2>
    ${results.length ? `<div class="table-wrap"><table class="rank"><thead><tr><th></th><th>Joueur</th><th>Score</th><th>Temps</th></tr></thead>
      <tbody>${results.map((r, i) => `<tr${me && r.user_id === me.id ? ' class="me"' : ''}><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td>${esc(r.profiles?.username || '?')}</td>
        <td><b>${r.score}/${r.total}</b></td><td>${fmtTime(r.seconds)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Personne n’a encore joué ce défi.</div>'}
  </section>`;
  $('#copy', el).onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('Lien copié'); }
    catch { $('#link', el).select(); }
  };
  const login = $('#login', el);
  if (login) login.onclick = () => askLogin('#/defi/' + id);
  const play = $('#play', el);
  if (play) play.onclick = async () => {
    const list = await loadList(c.list_snapshot ? 'defi:' + id : c.list_id);
    const qs = challengeQuestions(list, c.questions);
    if (!qs.length) { toast('Les questions de ce défi ne correspondent plus à la liste', 'err'); return; }
    startSession(el, list, { ...c.config, filters: {} }, { questions: qs, challenge: { id, listId: c.list_id } });
  };
}

// ======================= Admin =======================

export async function renderAdmin(el) {
  const me = currentUser();
  if (!me?.isAdmin) { el.innerHTML = '<div class="empty">Réservé aux administrateurs.</div>'; return; }
  const [users, board] = await Promise.all([allUsers(), leaderboard().catch(() => [])]);
  const stats = new Map(board.map(b => [b.username, b]));
  users.forEach(u => { u.is_admin = u.is_admin || u.is_super_admin; });
  const admins = users.filter(u => u.is_admin).length;
  el.innerHTML = `<section>
    <div class="page-head"><h1>Admin</h1>
      <p class="muted">${users.length} utilisateur${users.length > 1 ? 's' : ''} inscrit${users.length > 1 ? 's' : ''} · ${admins} admin${admins > 1 ? 's' : ''}.
      Un admin peut publier, modifier et retirer les listes du site depuis l’éditeur.
      Seul le super admin peut nommer ou retirer un admin, et personne ne peut retirer le super admin.</p></div>
    <p class="hint">📁 Les dossiers se gèrent directement sur l’<a href="#/">accueil</a> : bouton « + Nouveau dossier », menu ⋯ sur chaque dossier ou liste, et glisser-déposer.</p>
    <h2>Utilisateurs</h2>
    <div class="table-wrap"><table class="users">
      <thead><tr><th>Pseudo</th><th>Inscrit le</th><th>Parties</th><th>Points</th><th>Rôle</th></tr></thead>
      <tbody>${users.map(u => {
        const s = stats.get(u.username);
        return `<tr${u.id === me.id ? ' class="me"' : ''}><td><b>${esc(u.username)}</b>${u.id === me.id ? ' <span class="muted small">(vous)</span>' : ''}</td>
          <td class="small">${new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
          <td>${s?.sessions ?? 0}</td><td>${s?.points ?? 0}</td>
          <td class="nowrap">${u.is_super_admin ? '<span class="tag admin-tag">👑 super admin</span>'
            : u.is_admin ? `<span class="tag admin-tag">admin</span> ${me.isSuper ? `<button class="btn small ghost" data-id="${u.id}" data-v="0">Retirer admin</button>` : ''}`
            : me.isSuper ? `<button class="btn small" data-id="${u.id}" data-v="1">Rendre admin</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>
  </section>`;
  $$('[data-id]', el).forEach(b => b.onclick = async () => {
    const value = b.dataset.v === '1';
    const user = users.find(u => u.id === b.dataset.id);
    if (!b.dataset.confirm) {
      b.dataset.confirm = 1;
      b.textContent = value ? `Confirmer : ${user.username} admin` : (user.id === me.id ? 'Confirmer : ne plus être admin' : 'Confirmer le retrait');
      return;
    }
    b.disabled = true;
    try {
      await setAdmin(user.id, value);
      toast(value ? `${user.username} est maintenant admin` : `${user.username} n’est plus admin`);
      if (user.id === me.id && !value) { location.hash = '#/'; return; }
      renderAdmin(el);
    } catch (e) { toast(e.message, 'err'); b.disabled = false; }
  });
}

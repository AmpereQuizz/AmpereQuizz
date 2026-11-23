// Comptes, listes personnelles, scores et défis (Supabase).
import { SUPABASE_URL, SUPABASE_KEY, EMAIL_DOMAIN } from './config.js';

export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_KEY && window.supabase);
const sb = cloudEnabled
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// Supabase demande une adresse e-mail : on en fabrique une à partir du nom d'utilisateur (aucun mail n'est envoyé).
const emailOf = username => `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;

let me = null;
const listeners = new Set();
export function onUserChange(fn) { listeners.add(fn); }
function setMe(u) {
  me = u;
  listeners.forEach(fn => fn(me));
}

async function loadProfile(user) {
  if (!user) return null;
  let { data, error } = await sb.from('profiles').select('username, is_admin').eq('id', user.id).maybeSingle();
  // Avant l'installation de l'administration (supabase/admin.sql), la colonne is_admin n'existe pas.
  if (error) ({ data } = await sb.from('profiles').select('username').eq('id', user.id).maybeSingle());
  return { id: user.id, username: data?.username || user.user_metadata?.username || '?', isAdmin: !!data?.is_admin };
}

export async function initCloud() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  me = await loadProfile(data.session?.user);
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') setMe(null);
    else if (event === 'SIGNED_IN' && session?.user?.id !== me?.id) setMe(await loadProfile(session.user));
  });
  return me;
}

export const currentUser = () => me;

function frenchError(error) {
  const m = error?.message || String(error);
  if (/Invalid login credentials/i.test(m)) return 'Nom d’utilisateur ou mot de passe incorrect.';
  if (/already registered|already exists|duplicate/i.test(m)) return 'Ce nom d’utilisateur est déjà pris.';
  if (/Password should be at least/i.test(m)) return 'Mot de passe trop court (6 caractères minimum).';
  if (/Email not confirmed/i.test(m)) return 'Compte pas encore activé : dans Supabase, désactivez « Confirm email ».';
  if (/email.*invalid|invalid.*email/i.test(m)) return 'Supabase refuse l’adresse fabriquée (' + m + ') : prévenez Claude.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de connexion internet.';
  return m;
}

export async function signUp(username, password) {
  if (!USERNAME_RE.test(username)) throw new Error('Nom d’utilisateur : 3 à 20 caractères (lettres, chiffres, . _ -).');
  const { data, error } = await sb.auth.signUp({ email: emailOf(username), password, options: { data: { username: username.trim() } } });
  if (error) throw new Error(frenchError(error));
  if (!data.session) throw new Error('Compte créé, mais la connexion a échoué : dans Supabase, désactivez « Confirm email ».');
  setMe(await loadProfile(data.user));
  return me;
}

export async function signIn(username, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: emailOf(username), password });
  if (error) throw new Error(frenchError(error));
  setMe(await loadProfile(data.user));
  return me;
}

export async function signOut() {
  await sb.auth.signOut();
  setMe(null);
}

export async function changePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(frenchError(error));
}

function check({ data, error }) {
  if (error) throw new Error(frenchError(error));
  return data;
}

// ---------- Listes personnelles ----------

export async function myLists() {
  if (!me) return [];
  return check(await sb.from('user_lists').select('id, title, data, updated_at').order('updated_at', { ascending: false }));
}

export async function getMyList(id) {
  return check(await sb.from('user_lists').select('id, title, data').eq('id', id).maybeSingle());
}

export async function saveMyList(id, list) {
  const row = { title: list.title || 'Sans titre', data: list, updated_at: new Date().toISOString() };
  if (id) return check(await sb.from('user_lists').update(row).eq('id', id).select('id').single()).id;
  return check(await sb.from('user_lists').insert(row).select('id').single()).id;
}

export async function deleteMyList(id) {
  check(await sb.from('user_lists').delete().eq('id', id));
}

// ---------- Listes publiques (écrites par les administrateurs) ----------

export async function publicLists() {
  if (!sb) return [];
  const { data, error } = await sb.from('public_lists').select('id, title, data, hidden, updated_at');
  if (error) { console.warn('Listes publiques indisponibles', error.message); return []; }
  return data;
}

export async function savePublicList(id, list) {
  check(await sb.from('public_lists').upsert({ id, title: list.title || id, data: list, hidden: false, updated_at: new Date().toISOString() }).select('id'));
}

export async function hidePublicList(id, title) {
  check(await sb.from('public_lists').upsert({ id, title: title || id, data: null, hidden: true, updated_at: new Date().toISOString() }).select('id'));
}

// ---------- Scores ----------

export async function submitScore(s) {
  if (!me) return;
  check(await sb.from('scores').insert({
    list_id: s.listId, list_title: s.listTitle, mode: s.mode, exercise: s.exercise || null,
    score: s.score, total: s.total, seconds: s.seconds, challenge_id: s.challengeId || null,
  }));
}

export async function leaderboard() {
  return check(await sb.from('leaderboard').select('*').order('points', { ascending: false }).limit(100));
}

export async function listLeaderboard(listId) {
  return check(await sb.from('list_leaderboard').select('*').eq('list_id', listId).order('best_pct', { ascending: false }).order('points', { ascending: false }).limit(100));
}

export async function playedLists() {
  const rows = check(await sb.from('list_leaderboard').select('list_id, list_title'));
  const seen = new Map();
  rows.forEach(r => seen.set(r.list_id, r.list_title));
  return [...seen].map(([id, title]) => ({ id, title }));
}

export async function recentScores(limit = 30) {
  return check(await sb.from('scores').select('score, total, list_title, exercise, created_at, challenge_id, profiles(username)')
    .order('created_at', { ascending: false }).limit(limit));
}

// ---------- Défis ----------

export async function createChallenge(c) {
  return check(await sb.from('challenges').insert({
    title: c.title, list_id: c.listId, list_snapshot: c.snapshot || null, config: c.config, questions: c.questions,
  }).select('id').single()).id;
}

export async function getChallenge(id) {
  return check(await sb.from('challenges').select('*, profiles(username)').eq('id', id).maybeSingle());
}

export async function challengeResults(id) {
  return check(await sb.from('scores').select('score, total, seconds, created_at, user_id, profiles(username)')
    .eq('challenge_id', id).order('score', { ascending: false }).order('seconds', { ascending: true }));
}

export async function recentChallenges(limit = 20) {
  return check(await sb.from('challenges').select('id, title, created_at, profiles(username)')
    .order('created_at', { ascending: false }).limit(limit));
}

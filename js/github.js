// Enregistrement des listes dans le dépôt GitHub du site (un seul commit par envoi).
import { settings } from './store.js';

const API = 'https://api.github.com';

export function guessRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!m) return '';
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return seg ? `${m[1]}/${seg}` : `${m[1]}/${m[1]}.github.io`;
}

export function connection() {
  const s = settings.get();
  return s.ghToken ? { token: s.ghToken, repo: s.ghRepo || guessRepo(), branch: s.ghBranch || '' } : null;
}

async function call(conn, path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = res.status === 401 ? 'jeton refusé (expiré ou mal copié)'
      : res.status === 403 ? 'le jeton n’a pas le droit d’écrire dans ce dépôt'
      : res.status === 404 ? 'dépôt introuvable avec ce jeton (vérifiez qu’il donne accès à ce dépôt)'
      : body.message || res.statusText;
    throw new Error(msg);
  }
  return body;
}

// Vérifie le jeton et mémorise la connexion sur cet appareil.
export async function connect(token, repo) {
  const conn = { token: token.trim(), repo: repo.trim() };
  const info = await call(conn, `/repos/${conn.repo}`);
  if (info.permissions && !info.permissions.push) throw new Error('le jeton peut lire mais pas écrire dans ce dépôt');
  settings.set({ ghToken: conn.token, ghRepo: conn.repo, ghBranch: info.default_branch });
  return { ...conn, branch: info.default_branch };
}

export function disconnect() {
  settings.set({ ghToken: '', ghBranch: '' });
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// files : [{ path, data: Uint8Array }] ; data null = suppression.
export async function commitFiles(files, message, onStep = () => {}) {
  const conn = connection();
  if (!conn) throw new Error('appareil non connecté au dépôt');
  const r = conn.repo;
  let branch = conn.branch;
  if (!branch) {
    branch = (await call(conn, `/repos/${r}`)).default_branch;
    settings.set({ ghBranch: branch });
  }
  const tree = [];
  let n = 0;
  const total = files.filter(x => x.data).length;
  for (const f of files) {
    if (f.data === null) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
    onStep(`Envoi ${++n} / ${total} : ${f.path.split('/').pop()}`);
    const blob = await call(conn, `/repos/${r}/git/blobs`, {
      method: 'POST', body: JSON.stringify({ content: bytesToBase64(f.data), encoding: 'base64' }),
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  onStep('Enregistrement…');
  // Si le site a été modifié entre-temps (ex. images ajoutées automatiquement), on recommence sur la dernière version.
  for (let attempt = 0; ; attempt++) {
    try {
      const ref = await call(conn, `/repos/${r}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`);
      const parent = await call(conn, `/repos/${r}/git/commits/${ref.object.sha}`);
      const newTree = await call(conn, `/repos/${r}/git/trees`, {
        method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree }),
      });
      const commit = await call(conn, `/repos/${r}/git/commits`, {
        method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [parent.sha] }),
      });
      await call(conn, `/repos/${r}/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, {
        method: 'PATCH', body: JSON.stringify({ sha: commit.sha }),
      });
      return commit.sha;
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise(ok => setTimeout(ok, 1500));
    }
  }
}

// Lit un fichier texte directement dans le dépôt (version la plus récente, sans attendre la publication).
export async function readFile(path) {
  const conn = connection();
  if (!conn) return null;
  const ref = conn.branch ? `?ref=${encodeURIComponent(conn.branch)}` : '';
  try {
    const res = await fetch(`${API}/repos/${conn.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref}`, {
      cache: 'no-store', headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/vnd.github.raw+json' },
    });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

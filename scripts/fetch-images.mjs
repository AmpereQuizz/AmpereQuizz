// Récupère les images déclarées par { "wikipedia": "Titre" } ou { "commons": "Fichier.jpg" }
// dans les listes : télécharge une miniature dans lists/img/<liste>/ et note l'auteur et la licence.
// Lancé automatiquement par le déploiement (GitHub Actions). Usage : node scripts/fetch-images.mjs
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'lists');
const UA = 'quizz-static-site/1.0 (image fetcher run from GitHub Actions)';
const WIDTH = 800;

const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const stripHtml = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function api(host, params) {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${host} ${res.status}`);
  return res.json();
}

// "fr:Merle noir" → { lang: 'fr', title: 'Merle noir' } ; sans préfixe : français.
function parseWiki(ref) {
  const m = String(ref).match(/^([a-z]{2,3}):(.+)$/);
  return m ? { lang: m[1], title: m[2] } : { lang: 'fr', title: ref };
}

async function resolve(ref) {
  let host, file;
  if (ref.commons) {
    host = 'commons.wikimedia.org';
    file = ref.commons.replace(/^(File|Fichier):/i, '');
  } else {
    // Plusieurs titres possibles : on essaie dans l'ordre.
    const refs = Array.isArray(ref.wikipedia) ? ref.wikipedia : [ref.wikipedia];
    let lastErr;
    for (const w of refs) {
      try { return await resolveOne(parseWiki(w)); } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }
  return fileInfo(host, file);
}

async function resolveOne({ lang, title }) {
  const host = `${lang}.wikipedia.org`;
  const q = await api(host, { action: 'query', prop: 'pageimages', piprop: 'name', redirects: '1', titles: title });
  const file = q.query?.pages?.[0]?.pageimage;
  if (!file) throw new Error(`pas d'image libre pour « ${title} »`);
  return fileInfo(host, file);
}

async function fileInfo(host, file) {
  const info = await api(host, {
    action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: String(WIDTH), titles: 'File:' + file,
  });
  const ii = info.query?.pages?.[0]?.imageinfo?.[0];
  if (!ii) throw new Error(`fichier introuvable : ${file}`);
  const md = ii.extmetadata || {};
  return {
    url: ii.thumburl || ii.url,
    source: ii.descriptionurl,
    credit: stripHtml(md.Artist?.value) || stripHtml(md.Credit?.value) || 'Auteur inconnu',
    license: stripHtml(md.LicenseShortName?.value) || '',
    file,
  };
}

let changed = 0, errors = 0;
const files = (await readdir(root)).filter(f => f.endsWith('.json') && f !== 'index.json');
for (const f of files) {
  const listId = f.replace(/\.json$/, '');
  const path = join(root, f);
  const data = JSON.parse(await readFile(path, 'utf8'));
  const cols = (data.columns || []).filter(c => c.type === 'image');
  let dirty = false;
  for (const [i, row] of (data.rows || []).entries()) {
    for (const c of cols) {
      const key = c.key || slug(c.label);
      const v = row[key];
      if (!v || typeof v !== 'object' || v.src || !(v.wikipedia || v.commons)) continue;
      try {
        const r = await resolve(v);
        const ext = (r.url.match(/\.(jpe?g|png|webp|gif|svg)(?:$|\?)/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
        const rel = `img/${listId}/${row.id || slug(Object.values(row)[0]) || 'l' + i}-${key}.${ext}`;
        const res = await fetch(r.url, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`téléchargement ${res.status}`);
        await mkdir(dirname(join(root, rel)), { recursive: true });
        await writeFile(join(root, rel), Buffer.from(await res.arrayBuffer()));
        row[key] = { ...v, src: rel, credit: r.credit, license: r.license, source: r.source };
        dirty = true;
        changed++;
        console.log(`✓ ${listId} / ${row.id || i} : ${r.file} (${r.credit}, ${r.license})`);
        await new Promise(ok => setTimeout(ok, 150));
      } catch (e) {
        errors++;
        console.warn(`✗ ${listId} / ${row.id || i} : ${e.message}`);
      }
    }
  }
  if (dirty) await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
console.log(`${changed} image(s) récupérée(s), ${errors} échec(s).`);

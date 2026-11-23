// Génère lists/index.json à partir de tous les fichiers lists/*.json.
// Usage : node scripts/build-index.mjs
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'lists');
const files = (await readdir(root)).filter(f => f.endsWith('.json') && f !== 'index.json').sort();
const lists = [];
let failed = false;

for (const f of files) {
  const id = f.replace(/\.json$/, '');
  let data;
  try {
    data = JSON.parse(await readFile(join(root, f), 'utf8'));
  } catch (e) {
    console.error(`✗ ${f} : JSON invalide (${e.message})`);
    failed = true;
    continue;
  }
  if (!Array.isArray(data.columns) || !Array.isArray(data.rows)) {
    console.error(`✗ ${f} : il faut « columns » et « rows »`);
    failed = true;
    continue;
  }
  const img = data.columns.find(c => c.type === 'image');
  let cover = data.cover || null;
  if (!cover && img) {
    for (const r of data.rows) {
      const v = r[img.key];
      const src = typeof v === 'string' ? v : v?.src;
      if (src && !/^https?:|^data:/.test(src)) { cover = src; break; }
    }
  }
  lists.push({
    id,
    title: data.title || id,
    description: data.description || '',
    count: data.rows.length,
    columns: data.columns.map(c => c.label),
    ...(cover ? { cover } : {}),
  });
  console.log(`✓ ${f} : ${data.rows.length} fiches`);
}

lists.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
await writeFile(join(root, 'index.json'), JSON.stringify({ lists }, null, 2) + '\n');
console.log(`index.json : ${lists.length} listes`);
if (failed) process.exit(1);

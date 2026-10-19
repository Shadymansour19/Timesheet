// Fails if a t('key') used in src/ is missing from en or ar, or the two dictionaries differ.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../src/i18n/en.js';
import ar from '../src/i18n/ar.js';

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const used = new Set();
for (const f of walk('src').filter((f) => f.endsWith('.js') && !f.includes('i18n/'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('([a-z0-9_]+)'\)/g)) used.add(m[1]);
}
for (const role of ['user', 'admin', 'super_admin']) used.add('role_' + role); // built dynamically
let bad = 0;
for (const k of used) for (const [n, d] of [['en', en], ['ar', ar]]) if (!(k in d)) { console.log(`MISSING ${n}: ${k}`); bad++; }
for (const k of Object.keys(en)) if (!(k in ar)) { console.log(`ar lacks: ${k}`); bad++; }
for (const k of Object.keys(ar)) if (!(k in en)) { console.log(`en lacks: ${k}`); bad++; }
console.log(bad ? `FAIL: ${bad} problem(s)` : `PASS: ${used.size} keys used, en/ar in sync (${Object.keys(en).length})`);
process.exit(bad ? 1 : 0);

// Reads the quiz's D1 database (src/lib/store.ts) from a script, through wrangler:
//   d1(sql, remote)  the rows of one SQL statement; remote: the live EU database, else the local
//                    copy the dev server uses (.wrangler/state)
// Statements go in as text (wrangler d1 execute has no parameters): quote values with sq().
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));

export const sq = (v) => `'${String(v).replace(/'/g, "''")}'`;

export function d1(sql, remote) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'partidul-ai', remote ? '--remote' : '--local', '--json', '--command', sql], {
    cwd: web,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const res = JSON.parse(out);
  return res.flatMap((r) => r.results ?? []);
}

/** Run a SQL file. */
export function d1File(path, remote) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'partidul-ai', remote ? '--remote' : '--local', '--yes', '--file', path], { cwd: web, stdio: ['ignore', 'inherit', 'inherit'] });
}

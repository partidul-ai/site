// Checks question files against the schema in questions/README.md and against the wiki
// (section headings and source numbers must exist). No dependencies.
// Usage: node questions/validate.mjs [file.jsonl ...]   (default: all questions/*.jsonl)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const wikiDir = join(root, '..', 'wiki');

const TYPES = ['single', 'multi', 'scale', 'yesno', 'ranking', 'budget', 'text'];
const WITH_OPTIONS = ['single', 'multi', 'ranking', 'budget'];
const MEASURES = ['experience', 'satisfaction', 'priority', 'trend', 'tradeoff', 'expectation', 'trust', 'opinion'];
const AGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

function wikiInfo(domain) {
  const file = join(wikiDir, `${domain}.md`);
  if (!existsSync(file)) return null;
  const md = readFileSync(file, 'utf8');
  const sections = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  const surse = md.split(/^## Surse\s*$/m)[1] ?? '';
  const sources = new Set([...surse.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])));
  return { sections, sources };
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(root).filter((f) => f.endsWith('.jsonl')).map((f) => join(root, f));

let errors = 0, warnings = 0, total = 0;
const allIds = new Map();
const allTexts = new Map();
const groups = new Map(); // group -> ids

for (const file of files) {
  const domain = basename(file, '.jsonl');
  const wiki = wikiInfo(domain);
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const counts = { core: 0, pool: 0, text: 0 };
  const err = (i, msg) => { errors++; console.log(`${basename(file)}:${i + 1}: ${msg}`); };
  const warn = (i, msg) => { warnings++; console.log(`${basename(file)}:${i + 1}: warning: ${msg}`); };
  if (!wiki) err(-1, `no wiki page wiki/${domain}.md`);

  lines.forEach((line, i) => {
    let q;
    try { q = JSON.parse(line); } catch (e) { return err(i, `invalid JSON: ${e.message}`); }
    total++;
    const need = (cond, msg) => cond || err(i, `${q.id ?? '?'}: ${msg}`);

    need(typeof q.id === 'string' && new RegExp(`^${domain}-\\d{3}$`).test(q.id), `id must be "${domain}-NNN"`);
    if (allIds.has(q.id)) err(i, `duplicate id ${q.id} (also ${allIds.get(q.id)})`);
    allIds.set(q.id, `${basename(file)}:${i + 1}`);
    need(q.domain === domain, `domain must be "${domain}"`);
    need(['core', 'pool'].includes(q.tier), 'tier must be core | pool');
    need(TYPES.includes(q.type), `type must be one of ${TYPES.join(', ')}`);
    need(MEASURES.includes(q.measures), `measures must be one of ${MEASURES.join(', ')}`);
    need(typeof q.topic === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(q.topic), 'topic must be kebab-case');
    need(typeof q.text === 'string' && q.text.length >= 10, 'text missing');
    need(typeof q.rationale === 'string' && q.rationale.length > 10, 'rationale missing');
    need(q.na === null || (typeof q.na === 'string' && q.na.length > 1), 'na must be a label or null');
    need(q.ageRanges === null || (Array.isArray(q.ageRanges) && q.ageRanges.length && q.ageRanges.every((a) => AGES.includes(a))), `ageRanges must be null or a subset of ${AGES.join(', ')}`);
    need(!('counties' in q), 'no county-specific questions for now');

    const words = (q.text ?? '').split(/\s+/).length;
    need(words <= 40, `text is ${words} words (keep under ~30)`);
    const all = JSON.stringify(q);
    need(!/[şţŞŢ]/.test(all), 'cedilla ş/ţ found; use comma-below ș/ț');

    if (WITH_OPTIONS.includes(q.type)) {
      need(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 8, 'needs 2–8 options');
      if (Array.isArray(q.options)) {
        const ids = q.options.map((o) => o.id);
        need(new Set(ids).size === ids.length, 'option ids must be unique');
        need(q.options.every((o) => typeof o.id === 'string' && typeof o.label === 'string' && o.label.trim()), 'each option needs id and label');
        const labels = q.options.map((o) => o.label.trim().toLowerCase());
        need(new Set(labels).size === labels.length, 'duplicate option labels');
        if (q.na) need(!labels.includes(q.na.trim().toLowerCase()), 'na repeated as an option');
      }
    } else {
      need(q.options === undefined || q.options === null, `${q.type} has no options`);
    }
    if (q.type === 'multi' && q.maxSelect != null) need(Number.isInteger(q.maxSelect) && q.maxSelect >= 1 && q.maxSelect < (q.options?.length ?? 0), 'maxSelect must be 1..options-1');
    if ('profile' in q) need(q.profile === true && !q.outlook, 'profile must be true (or absent), and a profile question has no outlook');
    if ('where' in q) need(q.where === 'romania' || q.where === 'diaspora', 'where must be "romania" or "diaspora" (or absent: anyone can answer)');
    if ('group' in q) {
      need(typeof q.group === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(q.group), 'group must be kebab-case');
      groups.set(q.group, [...(groups.get(q.group) ?? []), q.id]);
    }
    if (q.type === 'scale') need(q.scale && typeof q.scale.minLabel === 'string' && typeof q.scale.maxLabel === 'string', 'scale needs minLabel and maxLabel');
    if (q.type === 'budget') need(q.budget && Number.isInteger(q.budget.total) && typeof q.budget.unit === 'string', 'budget needs total and unit');
    if ('outlook' in q) {
      const ids = q.type === 'yesno' ? ['da', 'nu'] : q.type === 'scale' ? ['1', '2', '3', '4', '5'] : (q.options ?? []).map((o) => o.id);
      const o = q.outlook ?? {};
      need(['single', 'multi', 'scale', 'yesno'].includes(q.type), `outlook not allowed on ${q.type}`);
      need(Object.keys(o).every((k) => ids.includes(k)), `outlook keys must be choice ids (${ids.join(', ')}), not na`);
      need(ids.every((k) => k in o), `outlook must cover every choice: ${ids.filter((k) => !(k in o)).join(', ')} missing`);
      need(Object.values(o).every((v) => [-1, -0.5, 0, 0.5, 1].includes(v)), 'outlook values must be -1, -0.5, 0, 0.5 or 1');
      need(new Set(Object.values(o)).size > 1, 'outlook gives every choice the same value');
    }
    // QUIZ.md rules 9–12, as warnings: the patterns are mechanical, the call isn't always.
    const answers = [...(q.options ?? []).map((o) => o.label), q.scale?.minLabel, q.scale?.maxLabel].filter((l) => typeof l === 'string');
    const low = answers.map((l) => l.trim().toLowerCase());
    if (answers.some((l) => /(?<!\p{L})cam(?!\p{L})/iu.test(l))) warn(i, `${q.id}: "cam" in an answer (rule 12): write "Lunar", "La fel", not "Cam lunar", "Cam la fel"`);
    const level = /(?<!\p{L})(deloc|rar|puțin|mult|des|zilnic|săptămânal|lunar|niciodată|uneori|mereu)\s+sau\s/iu;
    for (const l of answers.filter((l) => level.test(l))) warn(i, `${q.id}: "${l}" may join two answers in one (rule 10)`);
    if (low.some((l) => /aproape (niciun|nicioda)/.test(l)) && !low.some((l) => /^(niciunul|niciuna|niciodată|deloc)$/.test(l))) warn(i, `${q.id}: "aproape niciunul/niciodată" without its own "Niciunul"/"Niciodată" option (rule 11)`);
    if (q.type === 'ranking' && !/de la .+ la /i.test(q.text ?? '')) warn(i, `${q.id}: ranking doesn't say the order, e.g. "de la cel mai important la cel mai puțin important" (rule 9)`);

    counts[q.tier] = (counts[q.tier] ?? 0) + 1;
    if (q.type === 'text') counts.text++;

    if (wiki) {
      need(q.wiki && wiki.sections.includes(q.wiki.section), `wiki.section "${q.wiki?.section}" is not an H2 in wiki/${domain}.md`);
      need(Array.isArray(q.wiki?.sources), 'wiki.sources must be an array');
      const bad = (q.wiki?.sources ?? []).filter((n) => !wiki.sources.has(n));
      need(!bad.length, `wiki.sources ${bad.join(', ')} not in the Surse list`);
    }

    const key = (q.text ?? '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
    if (allTexts.has(key)) err(i, `${q.id}: same text as ${allTexts.get(key)}`);
    allTexts.set(key, q.id);
  });

  if (counts.text > 2) err(-1, `${counts.text} text questions (max 2 per domain)`);
  console.log(`${basename(file)}: ${lines.length} questions (core ${counts.core}, pool ${counts.pool})`);
}

// A group is two or more ways of asking the same thing (the quiz asks at most one of them).
if (!process.argv.slice(2).length)
  for (const [g, ids] of groups) if (ids.length < 2) errors++, console.log(`group "${g}" has only ${ids[0]}: a group needs two or more questions`);

const warned = warnings ? `, ${warnings} warning(s)` : '';
console.log(errors ? `\n${errors} problem(s) in ${total} questions${warned}` : `\nOK: ${total} questions${warned}`);
process.exit(errors ? 1 : 0);

// Wiki citations, as a Sätteri hast plugin (Astro 7's markdown processor):
// "[3]" in the text becomes a link to item 3 of the "Surse" list at the bottom,
// and each source gets an id (sursa-3) to land on.
import { defineHastPlugin } from 'satteri';

const SOURCES_HEADING = /^surse$/i;
const CITE = /\[(\d+)\]/g;
const HAS_CITE = /\[\d+\]/;
const SKIP = new Set(['a', 'code', 'pre']);

const isEl = (n, tag) => n?.type === 'element' && (!tag || n.tagName === tag);

// A factory, so each document gets its own state.
export default () => {
  let sourcesAt = -1; // index of the "Surse" <h2> among the root's children
  const ids = new Set();

  return defineHastPlugin({
    name: 'wiki-citations',

    before(root, ctx) {
      const top = root.children;
      sourcesAt = top.findIndex((n) => isEl(n, 'h2') && SOURCES_HEADING.test(ctx.textContent(n).trim()));
      if (sourcesAt === -1) return;
      const list = top.slice(sourcesAt + 1).find((n) => isEl(n, 'ol'));
      if (!list) return (sourcesAt = -1);
      let n = Number(list.properties?.start ?? 1);
      for (const li of list.children) {
        if (!isEl(li, 'li')) continue;
        ctx.setProperty(li, 'id', `sursa-${n}`);
        ids.add(n++);
      }
    },

    text(node, ctx) {
      if (sourcesAt === -1 || !HAS_CITE.test(node.value)) return;
      // Only above the sources list, and never inside links or code.
      let top = node;
      for (let p = ctx.parent(node); p && p.type !== 'root'; p = ctx.parent(p)) {
        if (SKIP.has(p.tagName)) return;
        top = p;
      }
      if ((ctx.indexOf(top) ?? Infinity) >= sourcesAt) return;

      const out = [];
      let last = 0;
      for (const m of node.value.matchAll(CITE)) {
        const num = Number(m[1]);
        if (!ids.has(num)) continue;
        if (m.index > last) out.push({ type: 'text', value: node.value.slice(last, m.index) });
        out.push({
          type: 'element',
          tagName: 'a',
          properties: { href: `#sursa-${num}`, className: ['cite'], ariaLabel: `Sursa ${num}` },
          children: [{ type: 'text', value: `[${num}]` }],
        });
        last = m.index + m[0].length;
      }
      if (!out.length) return;
      if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });
      ctx.replaceNode(node, out);
    },
  });
};

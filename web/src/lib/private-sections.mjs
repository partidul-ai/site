// Wiki sections that stay in the research files but not on the site: the
// "Idei de întrebări pentru chestionar" lists are working notes for the quiz.
// Removed in the Markdown AST, so they drop out of the table of contents too.
import { defineMdastPlugin } from 'satteri';

const PRIVATE = /^idei de întrebări/i;

const text = (n) => (n.value ?? '') + (n.children ?? []).map(text).join('');

export default defineMdastPlugin({
  name: 'wiki-private-sections',

  before(root, ctx) {
    let hiding = 0; // depth of the private heading being skipped, 0 when showing
    for (const n of root.children) {
      if (n.type === 'heading' && (!hiding || n.depth <= hiding)) {
        hiding = PRIVATE.test(text(n).trim()) ? n.depth : 0;
      }
      if (hiding) ctx.removeNode(n);
    }
  },
});

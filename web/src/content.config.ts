import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// The research wiki lives at the repo root (wiki/*.md) so it reads well on GitHub too.
// Lowercase names only: wiki/README.md is the GitHub index, not a page.
const wiki = defineCollection({
  loader: glob({ pattern: '[a-z]*.md', base: '../wiki' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    updated: z.coerce.date(),
    order: z.number(),
  }),
});

// The manifesto lives at the repo root too, next to the code it describes.
const manifest = defineCollection({
  loader: glob({ pattern: 'MANIFEST.md', base: '..' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    version: z.string(),
    updated: z.coerce.date(),
  }),
});

export const collections = { wiki, manifest };

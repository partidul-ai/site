// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';
import { satteri } from '@astrojs/markdown-satteri';
import citations from './src/lib/citations.mjs';
import privateSections from './src/lib/private-sections.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://partidul.ai',
  // Clean URLs: /wiki/sanatate, not /wiki/sanatate/ (pages build to .html files).
  trailingSlash: 'never',
  build: { format: 'file' },

  integrations: [
    react(),
    // The quiz page is a placeholder for now; keep it out until it's real.
    sitemap({ filter: (page) => !/\/(quiz|r)(\/|$)/.test(new URL(page).pathname) }),
  ],

  markdown: {
    // Wiki: [n] citations link to the "Surse" list. Quiz question notes stay in wiki/*.md but off the site.
    processor: satteri({ mdastPlugins: [privateSections], hastPlugins: [citations] })
  },

  vite: {
    plugins: [tailwindcss()]
  },

  adapter: cloudflare()
});

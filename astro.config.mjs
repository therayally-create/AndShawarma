// Astro config — static site, GitHub Pages, no adapter.
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://therayally-create.github.io',
  base: '/AndShawarma',
  output: 'static',
  build: {
    format: 'directory',
  },
});

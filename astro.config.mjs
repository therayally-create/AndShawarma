// Astro config for AndShawarma — static site hosted on GitHub Pages.
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://therayally-create.github.io',
  base: '/AndShawarma',
  output: 'static',
  build: {
    format: 'directory',
  },
});

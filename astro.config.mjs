// Astro config for AndShawarma — Vercel deployment (frontend + API together).
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://and-shawarma-v2.vercel.app',
  output: 'server',
  adapter: vercel(),
  build: { format: 'directory' },
});

import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server', // 👈 加上这一行，开启全局 SSR
  adapter: node({
    mode: 'standalone'
  })
});
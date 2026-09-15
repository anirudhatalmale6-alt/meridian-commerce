import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API is proxied under /api rather than called cross-origin. This is
    // not just tidiness: the auth cookies are httpOnly and SameSite=Lax, and a
    // cross-site XHR would not send them at all. Same-origin in dev means dev
    // behaves like production behind one domain, instead of "works locally,
    // nobody can stay logged in on staging".
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4310',
        changeOrigin: false,
      },
    },
  },
});

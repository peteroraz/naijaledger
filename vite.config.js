import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const projectId = env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || '';
  const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY || env.FIREBASE_WEB_API_KEY || '',
    projectId,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    appId: env.VITE_FIREBASE_APP_ID || env.FIREBASE_WEB_APP_ID || '',
  };
  return {
    plugins: [react(), {
      name: 'naijaledger-local-firebase-config',
      configureServer(server) {
        server.middlewares.use('/firebase-config.js', (_request, response) => {
          response.setHeader('Content-Type', 'application/javascript');
          response.setHeader('Cache-Control', 'no-store');
          response.end(`window.__NAIJALEDGER_FIREBASE__=${JSON.stringify(firebaseConfig).replaceAll('<', '\\u003c')};`);
        });
      },
    }],
    server: { allowedHosts: ['terminal.local'], proxy: { '/api': 'http://localhost:8080' } },
    build: { outDir: 'dist' },
  };
});

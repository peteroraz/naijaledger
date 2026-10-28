import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

declare global {
  interface Window { __NAIJALEDGER_FIREBASE__?: { apiKey?: string; authDomain?: string; projectId?: string; appId?: string } }
}
const runtime = window.__NAIJALEDGER_FIREBASE__ || {};
const config = {
  // Firebase Web identifiers are public. Private server credentials never go here.
  apiKey: runtime.apiKey || import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: runtime.authDomain || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: runtime.projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: runtime.appId || import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseReady = Object.values(config).every(Boolean);
export const auth = firebaseReady ? getAuth(initializeApp(config)) : null;

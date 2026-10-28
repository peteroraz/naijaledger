import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createFirestoreStore } from './store.mjs';

export function firebaseServices() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
  initializeApp({ credential: applicationDefault(), projectId });
  return {
    verifyToken: async token => (await getAuth().verifyIdToken(token)).uid,
    store: createFirestoreStore(getFirestore()),
  };
}

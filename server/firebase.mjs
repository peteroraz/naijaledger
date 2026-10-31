import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createFirestoreStore } from './store.mjs';
import { createFirestoreRagIndex } from './rag-store.mjs';

export function firebaseServices() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  return {
    verifyToken: async token => {
      const decoded = await getAuth().verifyIdToken(token);
      return {
        uid: decoded.uid,
        isAnonymous: decoded.firebase?.sign_in_provider === 'anonymous',
      };
    },
    store: createFirestoreStore(db),
    ragIndex: createFirestoreRagIndex(db),
  };
}

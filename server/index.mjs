import { createApp } from './app.mjs';
import { createVertexEmbedder } from './embeddings.mjs';
import { firebaseServices } from './firebase.mjs';
import { createRagAgent } from './rag.mjs';

const { verifyToken, store, ragIndex } = firebaseServices();
const ragAgent = createRagAgent({ ragIndex, embedder: createVertexEmbedder() });
const port = Number(process.env.PORT) || 8080;
createApp({ verifyToken, store, ragAgent }).listen(port, () => console.log(`NaijaLedger listening on ${port}`));

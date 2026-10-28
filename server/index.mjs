import { createApp } from './app.mjs';
import { firebaseServices } from './firebase.mjs';

const { verifyToken, store } = firebaseServices();
const port = Number(process.env.PORT) || 8080;
createApp({ verifyToken, store }).listen(port, () => console.log(`NaijaLedger listening on ${port}`));

const configScript = document.createElement('script');
configScript.src = '/firebase-config.js';
configScript.async = true;

configScript.addEventListener('load', () => {
  void import('./main');
});

configScript.addEventListener('error', () => {
  // Local builds can still use VITE_FIREBASE_* values if the runtime endpoint is unavailable.
  void import('./main');
});

document.head.appendChild(configScript);

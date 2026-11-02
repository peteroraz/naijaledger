const configScript = document.createElement('script');
configScript.src = '/firebase-config.js';
configScript.async = true;

const startApp = () => {
  void import('./main').catch(error => {
    console.error('NaijaLedger failed to start:', error);
    const root = document.getElementById('root');
    if (!root) return;
    const message = document.createElement('main');
    message.setAttribute('role', 'alert');
    message.style.cssText = 'max-width:760px;margin:12vh auto;padding:32px;font-family:system-ui,sans-serif;color:#19312b';
    const heading = document.createElement('h1');
    heading.textContent = 'NaijaLedger could not start';
    const detail = document.createElement('p');
    detail.textContent = 'A required page resource did not load. Refresh the page, then retry. If the problem continues, contact the demo owner.';
    message.append(heading, detail);
    root.replaceChildren(message);
  });
};

configScript.addEventListener('load', () => {
  startApp();
});

configScript.addEventListener('error', () => {
  // Local builds can still use VITE_FIREBASE_* values if the runtime endpoint is unavailable.
  startApp();
});

document.head.appendChild(configScript);

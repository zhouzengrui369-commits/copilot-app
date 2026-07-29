import React from 'react';
import ReactDOM from 'react-dom/client';
import { StartupAppBoundary } from './startup-shell.js';
import './styles/theme.css';
import './styles/app.css';

const browserPrototype = import.meta.env.VITE_COPILOT_BROWSER_PROTOTYPE === '1';
const browserPrototypeReady = browserPrototype
  ? import('./prototype/browser-api.js').then(({ installBrowserPrototype }) => {
      installBrowserPrototype();
    })
  : Promise.resolve();

const loadApp = () => browserPrototypeReady
  .then(() => import('./App'))
  .then((module) => ({ default: module.App }));

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('root element not found');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <StartupAppBoundary loadApp={loadApp} />
  </React.StrictMode>,
);

let appRootReported = false;
const reportVisibleAppRoot = () => {
  if (appRootReported) return;
  const appRoot = document.querySelector<HTMLElement>('[data-testid="app-root"]');
  if (!appRoot) return;
  const style = window.getComputedStyle(appRoot);
  if (style.display === 'none' || style.visibility === 'hidden') return;
  appRootReported = true;
  appRootObserver.disconnect();
  void window.copilot?.startup.appRootVisible();
};

const appRootObserver = new MutationObserver(() => {
  window.requestAnimationFrame(reportVisibleAppRoot);
});
appRootObserver.observe(rootEl, {
  attributes: true,
  childList: true,
  subtree: true,
});
window.requestAnimationFrame(reportVisibleAppRoot);

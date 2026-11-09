import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

// Translated strings are longer than English: widen the popup by browser UI language.
const uiLang = (browser.i18n?.getUILanguage?.() ?? navigator.language).toLowerCase();
if (uiLang.startsWith('fr') || uiLang.startsWith('es')) document.documentElement.style.setProperty('--popup-w', '410px');
if (uiLang.startsWith('de') || uiLang.startsWith('it')) document.documentElement.style.setProperty('--popup-w', '380px');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

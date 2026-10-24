import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { i18nReady } from './i18n/config';
import './index.css';
// Theme variables and theme-scoped rules (see the header of themes.css).
import './styles/themes.css';

// Render once the initial locale chunk is loaded (see i18n/config.ts). A
// failed download still renders: i18next then falls back to bundled English.
i18nReady.finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});

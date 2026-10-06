import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
/*
 * The two typefaces, self-hosted: Vite bundles the font files with the app,
 * so no font service ever learns who is playing (Help promises no
 * tracking). Variable fonts, so one file per face covers every weight;
 * Fontsource sets `font-display: swap`, so text shows at once in the
 * fallback and the face swaps in when it arrives. Schibsted Grotesk's
 * italic is the revealed digit's (board.css).
 */
import '@fontsource-variable/schibsted-grotesk/wght.css';
import '@fontsource-variable/schibsted-grotesk/wght-italic.css';
import '@fontsource-variable/bitter/wght.css';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

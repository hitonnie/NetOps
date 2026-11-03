import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
// Fonts are bundled (latin + latin-ext) so the game looks the same offline and in the desktop app:
// Press Start 2P for the 8-bit titles/buttons/numbers, Nunito for reading text.
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/press-start-2p/latin-ext-400.css';
import '@fontsource/nunito/latin-500.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/nunito/latin-ext-500.css';
import '@fontsource/nunito/latin-ext-600.css';
import '@fontsource/nunito/latin-ext-700.css';
import '@fontsource/nunito/latin-ext-800.css';
import '@fontsource/nunito/latin-ext-900.css';
// Tailwind + design tokens; pulls in the game stylesheet (styles.css) as a cascade layer
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

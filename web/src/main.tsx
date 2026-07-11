import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/newsreader/latin-400.css';
import '@fontsource/newsreader/latin-500.css';
import './globals';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { useVeilPledge } from './controller/useVeilPledge';

function VeilPledgeApplication() {
  const controller = useVeilPledge();
  return <App actions={controller.actions} viewModel={controller.viewModel} />;
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('VeilPledge root element was not found.');
}

createRoot(root).render(
  <StrictMode>
    <VeilPledgeApplication />
  </StrictMode>,
);

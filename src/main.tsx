import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { VaultProvider } from './state/VaultContext';
import { ToastProvider } from './state/Toast';
import { installNetLog } from './lib/netlog';
import './styles.css';

installNetLog();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <VaultProvider>
          <App />
        </VaultProvider>
      </ToastProvider>
    </HashRouter>
  </StrictMode>,
);

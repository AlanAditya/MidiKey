import { Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing';
import Shell from './components/Shell';
import Vault from './pages/Vault';
import AddRecord from './pages/AddRecord';
import RecordView from './pages/RecordView';
import Vitals from './pages/Vitals';
import Copilot from './pages/Copilot';
import Access from './pages/Access';
import Security from './pages/Security';
import Settings from './pages/Settings';
import ProviderHome from './pages/ProviderHome';
import ProviderPortal from './pages/ProviderPortal';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/provider" element={<ProviderHome />} />
      <Route path="/p/:id/:secret" element={<ProviderPortal />} />
      <Route element={<Shell />}>
        <Route path="/vault" element={<Vault />} />
        <Route path="/vault/new" element={<AddRecord />} />
        <Route path="/vault/:id" element={<RecordView />} />
        <Route path="/vitals" element={<Vitals />} />
        <Route path="/copilot" element={<Copilot />} />
        <Route path="/access" element={<Access />} />
        <Route path="/security" element={<Security />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}

import { NavLink, Navigate, Outlet, Link } from 'react-router-dom';
import { Activity, Bot, FolderLock, LockKeyhole, Settings as Cog, ShieldCheck, Share2 } from 'lucide-react';
import { Logo } from './common';
import { useVault } from '../state/VaultContext';

export default function Shell() {
  const v = useVault();
  if (v.status === 'loading') return null;
  if (v.status !== 'unlocked') return <Navigate to="/" replace />;
  const active = v.grants.filter((g) => g.status === 'active' && g.expiresAt > Date.now()).length;
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  return (
    <div className="shell">
      <a href="#main" className="skip" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <aside className="sidebar">
        <Link to="/vault" className="brand"><Logo /> <span>MediKey<small>Zero-trust vault</small></span></Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/vault" className={cls}><FolderLock size={18} /> Vault <span className="count">{v.records.length}</span></NavLink>
          <NavLink to="/vitals" className={cls}><Activity size={18} /> Vitals</NavLink>
          <NavLink to="/copilot" className={cls}><Bot size={18} /> Copilot</NavLink>
          <NavLink to="/access" className={cls}><Share2 size={18} /> Sharing {active > 0 && <span className="count">{active}</span>}</NavLink>
          <NavLink to="/security" className={cls}><ShieldCheck size={18} /> Security</NavLink>
          <NavLink to="/settings" className={cls}><Cog size={18} /> Settings</NavLink>
        </nav>
        <div className="side-foot">
          <div className="idchip">Your identity<span className="mono">{v.identity?.fingerprint}</span></div>
          <div className="row tight">
            <button className="btn sm grow" onClick={v.lock} aria-label="Lock vault now"><LockKeyhole size={15} /> Lock now</button>
          </div>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';

type Tone = 'ok' | 'bad' | 'info';
interface T {
  id: number;
  msg: string;
  tone: Tone;
}
const Ctx = createContext<(msg: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((msg: string, tone: Tone = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'bad' ? 7000 : 3800);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.tone === 'ok' ? <CheckCircle2 size={18} color="var(--ok)" /> : t.tone === 'bad' ? <AlertTriangle size={18} color="var(--danger)" /> : <Info size={18} color="var(--accent-2)" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

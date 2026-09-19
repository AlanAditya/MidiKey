import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Cpu, Send, Sparkles, ShieldCheck, WifiOff, Wand2 } from 'lucide-react';
import { useVault } from '../state/VaultContext';
import { answer, polishOnDevice, type Answer, type Block } from '../lib/copilot/rag';

interface Msg {
  role: 'user' | 'bot';
  text?: string;
  a?: Answer;
  polished?: string;
  q?: string;
}

const SUGGESTIONS = ['Which results are abnormal?', 'What medicines am I taking?', 'Summarize my health', 'How is my blood pressure trending?', 'What is HbA1c?', 'Explain atrial fibrillation'];

export default function Copilot() {
  const { records } = useVault();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [canPolish, setCanPolish] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const LM = (globalThis as unknown as { LanguageModel?: { availability(): Promise<string> } }).LanguageModel;
    LM?.availability().then((a) => setCanPolish(a !== 'unavailable')).catch(() => {});
  }, []);
  useEffect(() => {
    if (msgs.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs]);

  const ask = (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: 'user', text }, { role: 'bot', a: answer(text, records), q: text }]);
    setQ('');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>AI Health Copilot</h1>
          <p>Plain-language answers grounded in your own sanitized records.</p>
        </div>
        <span className="pill ok right"><WifiOff size={13} /> Runs on-device · no data sent</span>
      </div>

      <div className="notice info" style={{ marginBottom: 18 }}>
        <ShieldCheck size={18} />
        <div>
          <b>Private RAG pipeline.</b> Your question is matched against sanitized text chunks with BM25 retrieval in this browser tab, then answered from templates, a medical glossary and lab reference ranges — with citations.
          {canPolish ? ' Your browser\'s built-in on-device model can optionally rephrase answers.' : ''} Nothing is uploaded to any AI service.
        </div>
      </div>

      <div className="chat" aria-live="polite">
        {msgs.length === 0 && (
          <div className="card flat center" style={{ padding: 30 }}>
            <div className="big-ico"><Bot size={30} /></div>
            <h3>Ask about your records</h3>
            <p className="muted small">{records.length ? `Reading ${records.length} record${records.length > 1 ? 's' : ''} stored on this device.` : 'Your vault is empty — add a record first.'}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => <button key={s} className="btn sm" onClick={() => ask(s)}><Sparkles size={13} /> {s}</button>)}
            </div>
            {!records.length && <p style={{ marginTop: 14 }}><Link className="btn primary" to="/vault/new?demo=1">Add sample records</Link></p>}
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="bubble user">{m.text}</div>
          ) : (
            <div key={i} className="bubble">
              <h3 style={{ marginTop: 0 }}>{m.a!.title}</h3>
              {m.a!.blocks.map((b, j) => <BlockView key={j} b={b} />)}
              {m.polished && <div className="notice ok" style={{ margin: '10px 0' }}><Cpu size={18} /><div><b>On-device model:</b> {m.polished}</div></div>}
              {m.a!.sources.length > 0 && (
                <div className="row tight" style={{ marginTop: 8 }}>
                  <span className="muted small">Sources:</span>
                  {m.a!.sources.map((s) => <Link key={s.id} to={`/vault/${s.id}`} className="pill info">{s.title}</Link>)}
                </div>
              )}
              {canPolish && !m.polished && (
                <button className="btn sm" style={{ marginTop: 10 }} onClick={async () => {
                  const p = await polishOnDevice(m.a!, m.q!);
                  if (p) setMsgs((all) => all.map((x, k) => (k === i ? { ...x, polished: p } : x)));
                }}><Wand2 size={14} /> Rephrase on-device</button>
              )}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask e.g. “Are any of my labs out of range?”" aria-label="Ask the Copilot" />
        <button className="btn primary" disabled={!q.trim()}><Send size={16} /> Ask</button>
      </form>
    </>
  );
}

function BlockView({ b }: { b: Block }): ReactNode {
  switch (b.t) {
    case 'p': return <p>{b.text}</p>;
    case 'note': return <p className="hint">{b.text}</p>;
    case 'ul': return <ul>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
    case 'quote': return <blockquote>{b.text}<br /><small className="muted">— {b.source}</small></blockquote>;
    case 'terms': return <div>{b.terms.map((t) => <div className="term" key={t.term}><b>{t.term}</b> — {t.plain}</div>)}</div>;
    case 'labs':
      return (
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Test</th><th>Result</th><th>Reference</th><th>What it means</th></tr></thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  <td><b>{r.name}</b><br /><small className="muted">{r.recordTitle}</small></td>
                  <td className={`flag-${r.flag}`}>{r.value} {r.unit} {r.flag === 'high' ? '▲ High' : r.flag === 'low' ? '▼ Low' : '✓'}</td>
                  <td className="muted">{r.refText}</td>
                  <td className="small">{r.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

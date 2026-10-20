import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { MANUAL, searchManual } from '../content/manual';
import { useUi } from './ctx';
import { Icon } from './icons';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) out.push(<code key={`${key}-${i++}`}>{tok.slice(1, -1)}</code>);
    else out.push(<b key={`${key}-${i++}`}>{tok.slice(2, -2)}</b>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderArticle(body: string): ReactNode {
  const lines = body.split('\n');
  const out: ReactNode[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  let para: string[] = [];
  const flushList = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l, `li${out.length}-${i}`)}</li>)}</ul>);
    list = [];
  };
  const flushPara = () => {
    if (para.length) out.push(<p key={`p${out.length}`}>{inline(para.join(' '), `p${out.length}`)}</p>);
    para = [];
  };
  for (const l of lines) {
    if (l.startsWith('```')) {
      if (code) {
        out.push(<pre key={`pre${out.length}`}>{code.join('\n')}</pre>);
        code = null;
      } else {
        flushList();
        flushPara();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(l);
      continue;
    }
    if (l.startsWith('## ')) {
      flushList();
      flushPara();
      out.push(<h3 key={`h${out.length}`}>{l.slice(3)}</h3>);
    } else if (l.startsWith('- ')) {
      flushPara();
      list.push(l.slice(2));
    } else if (!l.trim()) {
      flushList();
      flushPara();
    } else {
      flushList();
      para.push(l);
    }
  }
  flushList();
  flushPara();
  return <>{out}</>;
}

export function ManualPanel() {
  const { ui, setUi } = useUi();
  const [q, setQ] = useState('');
  const results = useMemo(() => searchManual(q), [q]);
  const current = MANUAL.find((a) => a.id === ui.manualArticle) ?? MANUAL[0];
  const sections = [...new Set(results.map((a) => a.section))];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 250px) 1fr', flex: 1, minHeight: 0 }}>
      <nav style={{ overflow: 'auto', borderRight: '1px solid var(--border)', padding: 10 }} aria-label="Manual articles">
        <div className="row" style={{ marginBottom: 8 }}>
          <Icon name="search" size={18} />
          <input type="search" className="grow" placeholder="Search (e.g. trunk, dhcp, acl)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the manual" autoFocus />
        </div>
        {sections.map((s) => (
          <Fragment key={s}>
            <div className="section-title">{s}</div>
            {results
              .filter((a) => a.section === s)
              .map((a) => (
                <button key={a.id} className="btn ghost" style={{ display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal', padding: '5px 8px', background: a.id === current.id ? 'var(--sel)' : undefined, boxShadow: 'none' }} onClick={() => setUi((u) => ({ ...u, manualArticle: a.id }))} aria-current={a.id === current.id}>
                  {a.title}
                </button>
              ))}
          </Fragment>
        ))}
        {!results.length && <div className="muted">No matches.</div>}
      </nav>
      <article className="manual-article" style={{ overflow: 'auto', padding: '6px 18px 20px' }}>
        <h2 style={{ marginBottom: 2 }}>{current.title}</h2>
        <div className="dim" style={{ fontSize: 14 }}>
          {current.section} · {current.tags.slice(0, 5).join(', ')}
        </div>
        {renderArticle(current.body)}
      </article>
    </div>
  );
}

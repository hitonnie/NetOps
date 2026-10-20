import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Shell } from '../net/cli/shell';
import { useGameTick, useUi } from './ctx';

const SUGGEST: Record<Shell['kind'], string[]> = {
  ios: ['enable', 'show ip interface brief', 'show interfaces status', 'show logging', 'show running-config', 'show vlan brief', 'show interfaces trunk', 'show mac address-table', 'configure terminal', '?'],
  windows: ['ipconfig /all', 'ping 10.10.100.10', 'nslookup git.corp.local', 'tracert 8.8.8.8', 'ipconfig /renew', 'arp -a', 'netstat -ano', 'help'],
  linux: ['systemctl --failed', 'ip a', 'df -h', 'ss -tulpn', 'tail /var/log/syslog', 'help'],
};

export function Terminal({ shell, autoFocus = true }: { shell: Shell; autoFocus?: boolean }) {
  const { game } = useUi();
  useGameTick(game);
  const [, setN] = useState(0);
  const [input, setInput] = useState('');
  const [hIdx, setHIdx] = useState<number | null>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLInputElement>(null);
  const rerender = () => setN((n) => n + 1);

  useLayoutEffect(() => {
    const o = outRef.current;
    if (o) o.scrollTop = o.scrollHeight;
  });

  useEffect(() => {
    if (autoFocus) inRef.current?.focus();
  }, [autoFocus, shell]);

  const run = (text: string) => {
    shell.run(text);
    setInput('');
    setHIdx(null);
    rerender();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      run(input);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      setInput(shell.complete(input));
      return;
    }
    if (e.key === '?' && shell.kind === 'ios' && !shell.busy) {
      e.preventDefault();
      setInput(shell.help(input));
      rerender();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const h = shell.history;
      if (!h.length) return;
      const i = hIdx === null ? h.length - 1 : Math.max(0, hIdx - 1);
      setHIdx(i);
      setInput(h[i]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const h = shell.history;
      if (hIdx === null) return;
      const i = hIdx + 1;
      if (i >= h.length) {
        setHIdx(null);
        setInput('');
      } else {
        setHIdx(i);
        setInput(h[i]);
      }
      return;
    }
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      shell.lines.length = 0;
      rerender();
      return;
    }
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && !window.getSelection()?.toString()) {
      e.preventDefault();
      shell.lines.push({ t: `${shell.prompt()}${input}^C`, k: 'in' });
      setInput('');
      rerender();
      return;
    }
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && shell.kind === 'ios') {
      e.preventDefault();
      run('end');
    }
  };

  const lines = shell.lines.slice(-600);
  return (
    <div className="term" onClick={() => !window.getSelection()?.toString() && inRef.current?.focus()}>
      <div className="term-out" ref={outRef} role="log" aria-live="polite" aria-label="Terminal output">
        {lines.map((l, i) => (
          <div key={i} className={l.k ?? ''}>
            {l.t || ' '}
          </div>
        ))}
      </div>
      <div className="term-line">
        <span className="term-prompt">{shell.prompt()}</span>
        <input
          ref={inRef}
          className="term-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label={`Command input for ${shell.kind === 'ios' ? 'Cisco IOS' : shell.kind === 'windows' ? 'Windows command prompt' : 'Linux shell'}`}
        />
      </div>
      <div className="term-help">
        {SUGGEST[shell.kind].map((s) => (
          <button
            key={s}
            className="btn small ghost mono"
            style={{ fontSize: 12.5, padding: '1px 6px' }}
            onClick={(e) => {
              e.stopPropagation();
              if (s === '?') {
                setInput(shell.help(input));
                rerender();
              } else setInput(s);
              inRef.current?.focus();
            }}
            title="Insert command (press Enter to run)"
          >
            {s}
          </button>
        ))}
        <span style={{ marginLeft: 6 }}>
          <kbd>↑</kbd>/<kbd>↓</kbd> history · <kbd>Tab</kbd> complete{shell.kind === 'ios' ? <> · <kbd>?</kbd> help · <kbd>Ctrl+Z</kbd> end</> : null} · <kbd>Ctrl+L</kbd> clear
        </span>
      </div>
    </div>
  );
}

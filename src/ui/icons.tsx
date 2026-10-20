/** Small inline SVG icon set (original, stroke-based). */
import type { CSSProperties } from 'react';

const P: Record<string, string> = {
  mail: 'M4 6h16v12H4z M4 7l8 6 8-6',
  tasks: 'M9 6h11 M9 12h11 M9 18h11 M4 6l1.5 1.5L7 5 M4 12l1.5 1.5L7 11 M4 18l1.5 1.5L7 17',
  cart: 'M3 4h2l2.4 10.5h10.2L20 7H6.2 M9 19.5a1 1 0 1 0 0 .01 M17 19.5a1 1 0 1 0 0 .01',
  briefcase: 'M4 8h16v11H4z M9 8V5h6v3 M4 13h16',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11',
  network: 'M12 4v4 M5 16v-3h14v3 M12 13V8 M9 4h6v4H9z M2.5 16h5v4h-5z M9.5 16h5v4h-5z M16.5 16h5v4h-5z',
  list: 'M4 6h16 M4 12h16 M4 18h10',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 2v3 M12 19v3 M4.2 4.2l2.1 2.1 M17.7 17.7l2.1 2.1 M2 12h3 M19 12h3 M4.2 19.8l2.1-2.1 M17.7 6.3l2.1-2.1',
  pause: 'M8 5v14 M16 5v14',
  play: 'M7 4l12 8-12 8z',
  ff: 'M4 5l8 7-8 7z M12 5l8 7-8 7z',
  warning: 'M12 3l10 18H2z M12 10v5 M12 18v.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M12 8v5 M12 16v.01',
  close: 'M6 6l12 12 M18 6L6 18',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  terminal: 'M4 5h16v14H4z M7 9l3 3-3 3 M12 15h5',
  power: 'M12 3v8 M6.3 6.3a8 8 0 1 0 11.4 0',
  cable: 'M7 3v5 M10 3v5 M5.5 8h6v4a3 3 0 0 1-6 0z M8.5 15v3a3 3 0 0 0 6 0V9a3 3 0 0 1 6 0v12',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 7.5v.01',
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.7.5 1 1.2 1 2.1h5c0-.9.3-1.6 1-2.1A6 6 0 0 0 12 3z',
  send: 'M3 11l18-8-8 18-2-8z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.4 1.4 M17.6 17.6L19 19 M5 19l1.4-1.4 M17.6 6.4L19 5',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4 M8 11h6 M11 8v6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4 M8 11h6',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 1v4 M12 19v4 M1 12h4 M19 12h4',
  plug: 'M9 3v5 M15 3v5 M6 8h12v3a6 6 0 0 1-12 0z M12 17v4',
  check: 'M5 12l5 5 9-10',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z',
  archive: 'M3 5h18v4H3z M5 9v10h14V9 M10 13h4',
  wifi: 'M2 9a15 15 0 0 1 20 0 M5.5 12.5a10 10 0 0 1 13 0 M9 16a5 5 0 0 1 6 0 M12 19.5v.01',
  server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7v.01 M8 17v.01',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 20a8 8 0 0 1 16 0',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7 M12 16.5v.01',
  skip: 'M5 5l9 7-9 7z M18 5v14',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  save: 'M5 3h12l3 3v15H5z M8 3v5h8V3 M8 21v-7h8v7',
};

export function Icon({ name, size = 20, style, title }: { name: keyof typeof P | string; size?: number; style?: CSSProperties; title?: string }) {
  const d = P[name] ?? P.info;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {d.split(' M').map((seg, i) => (
        <path key={i} d={i === 0 ? seg : `M${seg}`} />
      ))}
    </svg>
  );
}

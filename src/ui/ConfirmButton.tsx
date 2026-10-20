import { type ReactNode, useEffect, useState } from 'react';

/**
 * A button that asks for a second click instead of a native confirm() popup.
 * The first click arms it (showing `confirmLabel`); a second click within a few
 * seconds runs the action.
 */
export function ConfirmButton({ onConfirm, children, confirmLabel, className = 'btn', style, title, autoFocus }: { onConfirm: () => void; children: ReactNode; confirmLabel: ReactNode; className?: string; style?: React.CSSProperties; title?: string; autoFocus?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`${className} ${armed ? 'danger' : ''}`}
      style={style}
      title={title}
      autoFocus={autoFocus}
      aria-live="polite"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

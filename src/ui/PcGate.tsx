import { type ReactNode, useEffect, useState } from 'react';

const MIN_W = 1024;
const MIN_H = 600;

const hasMouse = () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(any-pointer: fine)').matches;
const tooSmall = () => window.innerWidth < MIN_W || window.innerHeight < MIN_H;

/** NetOps is a PC game: it needs a mouse + keyboard and a desktop-sized window. */
export function PcGate({ children }: { children: ReactNode }) {
  const [mouse, setMouse] = useState(hasMouse);
  const [small, setSmall] = useState(tooSmall);
  const [ignoreSize, setIgnoreSize] = useState(false);
  useEffect(() => {
    const onResize = () => setSmall(tooSmall());
    const mq = window.matchMedia?.('(any-pointer: fine)');
    const onPointer = () => setMouse(hasMouse());
    window.addEventListener('resize', onResize);
    mq?.addEventListener?.('change', onPointer);
    return () => {
      window.removeEventListener('resize', onResize);
      mq?.removeEventListener?.('change', onPointer);
    };
  }, []);

  if (!mouse) {
    return (
      <div className="pc-gate" role="alert">
        <div className="modal">
          <img src="/favicon.svg" alt="" width={64} height={64} style={{ imageRendering: 'pixelated' }} />
          <h2>NetOps is a PC game</h2>
          <p>It's built for a desktop or laptop with a mouse and keyboard — touch screens aren't supported. Open this page on your computer to play.</p>
        </div>
      </div>
    );
  }
  return (
    <>
      {children}
      {small && !ignoreSize && (
        <div className="pc-gate" role="alert">
          <div className="modal">
            <img src="/favicon.svg" alt="" width={64} height={64} style={{ imageRendering: 'pixelated' }} />
            <h2>Make the window bigger</h2>
            <p>
              NetOps needs at least {MIN_W}×{MIN_H} pixels — your window is {window.innerWidth}×{window.innerHeight}. Maximise the browser window (or press <kbd>F11</kbd> for full screen) for the best experience.
            </p>
            <button className="btn" onClick={() => setIgnoreSize(true)}>
              Continue anyway
            </button>
          </div>
        </div>
      )}
    </>
  );
}

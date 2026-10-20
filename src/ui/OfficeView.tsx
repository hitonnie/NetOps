import { useEffect, useMemo, useRef, useState } from 'react';
import { type Hit, OfficeRenderer, type ViewState, WORLD } from '../render/renderer';
import { BH, BW, T } from '../world/layout';
import { useUi } from './ctx';

export function clampCam(c: { x: number; y: number; zoom: number }) {
  c.zoom = Math.max(0.5, Math.min(4, c.zoom));
  c.x = Math.max(WORLD.x0 + 4 * T, Math.min(WORLD.x1 - 4 * T, c.x));
  c.y = Math.max(WORLD.y0 + 4 * T, Math.min(WORLD.y1 - 4 * T, c.y));
}

/** Zoom that fits the whole office as large as possible, leaving room for the left dock. */
export function fitZoom(w: number, h: number): number {
  return Math.max(0.5, Math.min((w - DOCK_W) / (BW * T + 30), (h - 10) / (BH * T + 40)));
}

/** Camera centre for the fitted view (shifted right to clear the dock). */
export function fitCenter(zoom: number): { x: number; y: number } {
  return { x: (BW * T) / 2 - DOCK_W / 2 / zoom, y: (BH * T) / 2 + 6 / zoom };
}

/** Width reserved for the left dock (px). */
export const DOCK_W = 104;

export function OfficeView() {
  const { game, ui, select, selectEmp, openDevice, setDrawer, cameraRef } = useUi();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useMemo(() => new OfficeRenderer(), []);
  const viewRef = useRef<ViewState>({ selected: null, selectedEmp: null, hover: null, cables: 'auto', overlay: 'none', labels: true, reducedMotion: false });
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const [cursor, setCursor] = useState<'grab' | 'grabbing' | 'pointer'>('grab');
  const drag = useRef<{ id: number; x: number; y: number; cx: number; cy: number; moved: number } | null>(null);
  const initd = useRef(false);

  viewRef.current = {
    ...viewRef.current,
    selected: ui.selected,
    selectedEmp: ui.selectedEmp,
    cables: ui.cables,
    overlay: ui.overlay,
    labels: game.s.settings.labels,
    reducedMotion: game.s.settings.reducedMotion,
  };

  // main loop: advance simulation + draw
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      game.frame(dt);
      const c = canvasRef.current;
      if (c) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        if (!initd.current && w > 0) {
          initd.current = true;
          cameraRef.current.zoom = fitZoom(w, h);
          Object.assign(cameraRef.current, fitCenter(cameraRef.current.zoom));
        }
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          renderer.draw(ctx, w, h, game, cameraRef.current, viewRef.current, now / 1000);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, renderer, cameraRef]);

  const toWorld = (sx: number, sy: number) => {
    const c = canvasRef.current!;
    const cam = cameraRef.current;
    return { x: (sx - c.clientWidth / 2) / cam.zoom + cam.x, y: (sy - c.clientHeight / 2) / cam.zoom + cam.y };
  };

  const describe = (h: Hit): string[] => {
    if (h.kind === 'emp') {
      const { r, e } = game.employeeAt(h.id);
      const mood = e.frustration > 60 ? 'Frustrated' : e.frustration > 30 ? 'Annoyed' : 'Content';
      const lines = [`${r.name} — ${r.role}`, `${r.dept} · ${e.activity}`, `Mood: ${mood}`];
      if (e.failing.length && e.blockedSince !== null) lines.push(`Problem: ${e.failing.join(', ')}`);
      return lines;
    }
    if (h.kind === 'dev') {
      const d = game.dev(h.id);
      if (!d) return [];
      const e = game.engine;
      const state = !e.c.devPowered.get(d.id) ? 'Powered off' : !e.isUp(d.id) ? 'Booting…' : 'Running';
      const lines = [d.kind === 'rogue' ? 'Unknown device (not in inventory)' : `${d.name} — ${d.model}`, `Status: ${state}`];
      const ip = e.primaryIf(d)?.ip;
      if (ip && d.kind !== 'rogue') lines.push(`IP: ${ip}`);
      if (d.ownerId) lines.push(`User: ${game.ownerOf(d.id)?.name}`);
      lines.push('Click to inspect');
      return lines;
    }
    return [];
  };

  // PC-only controls: mouse drag pans, wheel zooms, click selects. Touch input is ignored.
  const onPointerDown = (ev: React.PointerEvent) => {
    if (ev.pointerType === 'touch' || ev.button > 2) return;
    const c = canvasRef.current!;
    c.setPointerCapture(ev.pointerId);
    const rect = c.getBoundingClientRect();
    const p = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    drag.current = { id: ev.pointerId, x: p.x, y: p.y, cx: cameraRef.current.x, cy: cameraRef.current.y, moved: 0 };
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    if (ev.pointerType === 'touch') return;
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const p = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    const d = drag.current;
    if (d && d.id === ev.pointerId) {
      const cam = cameraRef.current;
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      d.moved = Math.max(d.moved, Math.hypot(dx, dy));
      if (d.moved > 4) {
        cam.x = d.cx - dx / cam.zoom;
        cam.y = d.cy - dy / cam.zoom;
        clampCam(cam);
        setCursor('grabbing');
        if (d.moved > 40) game.flag('panned');
        setTip(null);
      }
      return;
    }
    const w = toWorld(p.x, p.y);
    const hit = renderer.hitTest(game, w.x, w.y);
    const h = hit && hit.kind !== 'room' ? hit : null;
    viewRef.current.hover = h;
    setCursor(h ? 'pointer' : 'grab');
    if (h) setTip({ x: p.x + 16, y: p.y + 14, lines: describe(h) });
    else setTip(null);
  };

  const onPointerUp = (ev: React.PointerEvent) => {
    const d = drag.current;
    const c = canvasRef.current!;
    if (!d || d.id !== ev.pointerId) return;
    drag.current = null;
    setCursor('grab');
    if (d.moved > 5) return;
    const rect = c.getBoundingClientRect();
    const w = toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    const hit = renderer.hitTest(game, w.x, w.y);
    if (!hit) {
      select(null);
      selectEmp(null);
      return;
    }
    if (hit.kind === 'emp') {
      selectEmp(hit.id);
      return;
    }
    if (hit.kind === 'dev') {
      select(hit.id);
      openDevice(hit.id);
      return;
    }
    if (hit.kind === 'room') {
      if (hit.id === 'mgr') setDrawer('manager');
      select(null);
      selectEmp(null);
    }
  };

  const onWheel = (ev: React.WheelEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const before = toWorld(sx, sy);
    const cam = cameraRef.current;
    cam.zoom *= Math.exp(-ev.deltaY * 0.0015);
    clampCam(cam);
    const after = toWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    clampCam(cam);
    game.flag('zoomed');
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`office-canvas ${cursor === 'grabbing' ? 'dragging' : cursor === 'pointer' ? 'pointer' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onPointerLeave={() => {
          setTip(null);
          viewRef.current.hover = null;
        }}
        onWheel={onWheel}
        role="img"
        aria-label="Bird's-eye view of the office. Use the Network panel (N) for a keyboard-accessible list of devices."
      />
      {tip && (
        <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.lines.map((l, i) => (
            <div key={i} style={i === 0 ? { fontWeight: 700 } : { color: 'var(--muted)' }}>
              {l}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

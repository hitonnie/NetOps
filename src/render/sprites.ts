/** Procedural top-down sprites: people, furniture and network equipment. */
import type { Appearance } from '../sim/types';

type Ctx = CanvasRenderingContext2D;

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Draw a person seen from above, facing angle `dir` (radians, 0 = +x). */
export function drawPerson(ctx: Ctx, x: number, y: number, dir: number, a: Appearance, walking: boolean, phase: number, seated: boolean): void {
  const s = a.build;
  ctx.save();
  ctx.translate(x, y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(1.5, 2.5, 9 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(dir);
  // feet (walking)
  if (walking) {
    const sw = Math.sin(phase) * 3.2;
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.ellipse(sw + 1, -3 * s, 2.6, 1.8, 0, 0, Math.PI * 2);
    ctx.ellipse(-sw + 1, 3 * s, 2.6, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // arms
  const armSwing = walking ? Math.sin(phase) * 2.5 : 0;
  ctx.fillStyle = shade(a.shirt, -25);
  ctx.beginPath();
  ctx.ellipse(-armSwing + (seated ? 3 : 0), -7.2 * s, 2.6, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(armSwing + (seated ? 3 : 0), 7.2 * s, 2.6, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // torso (shoulders)
  ctx.fillStyle = a.shirt;
  ctx.beginPath();
  ctx.ellipse(0, 0, 5.2 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shade(a.shirt, -40);
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // collar / accent
  ctx.fillStyle = a.accent;
  ctx.beginPath();
  ctx.ellipse(1.2, 0, 1.6, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  if (a.accessory === 4) {
    ctx.strokeStyle = a.accent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, 4.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  // head
  const hx = 0.8;
  if (a.hairStyle === 7) {
    // hijab drapes over shoulders
    ctx.fillStyle = a.accent;
    ctx.beginPath();
    ctx.ellipse(-0.5, 0, 6.2, 6.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = a.skin;
  ctx.beginPath();
  ctx.arc(hx, 0, 4.6, 0, Math.PI * 2);
  ctx.fill();
  // hair
  ctx.fillStyle = a.hair;
  switch (a.hairStyle) {
    case 0: // short
      ctx.beginPath();
      ctx.arc(hx - 0.6, 0, 4.7, Math.PI * 0.55, Math.PI * 1.45 + 0.0001, false);
      ctx.arc(hx + 0.6, 0, 2.2, Math.PI * 1.4, Math.PI * 0.6, true);
      ctx.fill();
      break;
    case 1: // long
      ctx.beginPath();
      ctx.ellipse(hx - 2.2, 0, 5.4, 5.6, 0, Math.PI * 0.45, Math.PI * 1.55);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hx - 0.4, 0, 4.7, Math.PI * 0.6, Math.PI * 1.4);
      ctx.fill();
      break;
    case 2: // bun
      ctx.beginPath();
      ctx.arc(hx - 0.5, 0, 4.7, Math.PI * 0.55, Math.PI * 1.45);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hx - 5, 0, 2.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 3: // bald — small highlight
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(hx - 1, -1, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 4: // curly
      for (let k = 0; k < 7; k++) {
        const ang = Math.PI * 0.55 + (k / 6) * Math.PI * 0.9;
        ctx.beginPath();
        ctx.arc(hx + Math.cos(ang) * 3.8, Math.sin(ang) * 3.8, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 5: // ponytail
      ctx.beginPath();
      ctx.arc(hx - 0.5, 0, 4.7, Math.PI * 0.55, Math.PI * 1.45);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hx - 6.5, 0, 3, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 6: // buzz
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.arc(hx - 0.3, 0, 4.4, Math.PI * 0.5, Math.PI * 1.5);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case 7: // hijab front edge
      ctx.fillStyle = a.accent;
      ctx.beginPath();
      ctx.arc(hx - 0.3, 0, 4.9, Math.PI * 0.5, Math.PI * 1.5);
      ctx.fill();
      break;
  }
  // accessories
  if (a.accessory === 1) {
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(hx, 0, 5.2, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(hx + 0.3, -5, 1.6, 0, Math.PI * 2);
    ctx.arc(hx + 0.3, 5, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (a.accessory === 2) {
    ctx.fillStyle = a.accent;
    ctx.beginPath();
    ctx.arc(hx - 0.4, 0, 4.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(a.accent, -30);
    ctx.beginPath();
    ctx.ellipse(hx + 4.5, 0, 2.4, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (a.accessory === 3) {
    ctx.fillStyle = a.accent;
    ctx.beginPath();
    ctx.arc(hx - 0.4, 0, 4.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.arc(hx - 0.8, 0, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // face direction marker (nose)
  ctx.fillStyle = shade(a.skin, -18);
  ctx.beginPath();
  ctx.arc(hx + 4.2, 0, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawBubble(ctx: Ctx, x: number, y: number, icon: string, t: number): void {
  const bob = Math.sin(t * 4) * 1.2;
  ctx.save();
  ctx.translate(x + 9, y - 16 + bob);
  const bad = icon === 'no-net' || icon === 'printer-x';
  ctx.fillStyle = bad ? '#fff1f0' : '#ffffff';
  ctx.strokeStyle = bad ? '#d92d20' : icon === 'slow' ? '#c4320a' : '#475467';
  ctx.lineWidth = 1.2;
  roundRect(ctx, -9, -8, 18, 15, 5);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-4, 7);
  ctx.lineTo(-7, 11);
  ctx.lineTo(0, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = bad ? '#d92d20' : '#344054';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1.4;
  if (icon === 'no-net') {
    // wifi with cross
    for (let r = 2; r <= 6; r += 2) {
      ctx.beginPath();
      ctx.arc(0, 4, r, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-5, -5);
    ctx.lineTo(5, 5);
    ctx.moveTo(5, -5);
    ctx.lineTo(-5, 5);
    ctx.stroke();
  } else if (icon === 'slow') {
    // hourglass
    ctx.strokeStyle = '#c4320a';
    ctx.beginPath();
    ctx.moveTo(-4, -5);
    ctx.lineTo(4, -5);
    ctx.lineTo(-4, 4);
    ctx.lineTo(4, 4);
    ctx.closePath();
    ctx.stroke();
  } else if (icon === 'question') {
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 0);
  } else if (icon === 'printer-x') {
    ctx.strokeRect(-5, -2, 10, 6);
    ctx.strokeRect(-3, -5, 6, 3);
    ctx.beginPath();
    ctx.moveTo(3, 1);
    ctx.lineTo(7, 5);
    ctx.stroke();
  } else if (icon === 'restart') {
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0.3, Math.PI * 1.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(4.5, -2);
    ctx.lineTo(4.5, 1.5);
    ctx.lineTo(1.5, 0.5);
    ctx.fill();
  } else if (icon === 'coffee') {
    ctx.strokeRect(-4, -2, 7, 6);
    ctx.beginPath();
    ctx.arc(4, 1, 2, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  } else {
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('…', 0, -1);
  }
  ctx.restore();
}

export function led(ctx: Ctx, x: number, y: number, color: string, r = 1.6, glow = false): void {
  if (glow) {
    ctx.fillStyle = color + '55';
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export const LED = { ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444', off: '#4b5563', blue: '#38bdf8', act: '#a3e635' };

export function drawWarning(ctx: Ctx, x: number, y: number, size: number, pulse: number): void {
  ctx.save();
  ctx.translate(x, y);
  const s = size * (1 + Math.sin(pulse * 5) * 0.08);
  ctx.fillStyle = 'rgba(220, 38, 38, 0.25)';
  ctx.beginPath();
  ctx.arc(0, 0, s * 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#dc2626';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.95, s * 0.75);
  ctx.lineTo(-s * 0.95, s * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(s * 1.1)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, s * 0.18);
  ctx.restore();
}

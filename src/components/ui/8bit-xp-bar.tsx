import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface XpBarProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  /** 0–100 */
  value: number;
  /** Left caption (default "XP"). */
  label?: React.ReactNode;
  /** Right caption (default the rounded percentage). */
  valueLabel?: React.ReactNode;
  /** "default" is a solid fill, "retro" is chunky segments. */
  variant?: 'default' | 'retro';
  /** Show the blinking LEVEL UP! banner once the bar is full. */
  levelUp?: boolean;
  levelUpText?: string;
  /** Fill colour (any CSS colour); defaults to the XP yellow. */
  fill?: string;
  /** Hide the caption row. */
  bare?: boolean;
  size?: 'sm' | 'md';
}

/** 8-bit experience / progress bar. */
export function XpBar({ value, label = 'XP', valueLabel, variant = 'default', levelUp = false, levelUpText = 'LEVEL UP!', fill = 'var(--xp)', bare = false, size = 'md', className, ...props }: XpBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  const showLevelUp = levelUp && pct >= 100;
  const h = size === 'sm' ? 'h-3' : 'h-4';
  return (
    <div className={cn('retro w-full', className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} {...props}>
      {!bare && (
        <div className="mb-2 flex items-center justify-between gap-3 text-[10px] text-foreground">
          <span className="truncate">{label}</span>
          <span className="shrink-0">{valueLabel ?? `${Math.round(pct)}%`}</span>
        </div>
      )}
      <div className={cn('pixel-box relative bg-xp-track [--pb:var(--xp-border)] [--pw:3px]', h, 'mx-[3px]')}>
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-500"
          style={
            variant === 'retro'
              ? { width: `${pct}%`, background: `repeating-linear-gradient(90deg, ${fill} 0 9px, transparent 9px 12px)`, backgroundClip: 'content-box', padding: 2 }
              : { width: `${pct}%`, background: fill }
          }
        />
        {showLevelUp && <span className="xp-levelup absolute inset-0 flex items-center justify-center text-[9px] leading-none text-white">{levelUpText}</span>}
      </div>
    </div>
  );
}

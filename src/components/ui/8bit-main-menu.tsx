import type * as React from 'react';
import { cn } from '@/lib/utils';

import { Button, type ButtonProps } from '@/components/ui/8bit-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/8bit-card';

export interface MainMenuItem {
  /** Stable key, so a toggling label ("TUTORIAL: ON/OFF") keeps keyboard focus. */
  id?: string;
  label: string;
  action: () => void;
  variant?: ButtonProps['variant'];
  disabled?: boolean;
  hint?: string;
}

const menuItems: MainMenuItem[] = [
  {
    label: 'START GAME',
    action: () => console.log('Starting game...'),
  },
  {
    label: 'OPTIONS',
    action: () => console.log('Showing options...'),
  },
  {
    label: 'HIGH SCORES',
    action: () => console.log('Showing high scores...'),
  },
  {
    label: 'MULTIPLAYER',
    action: () => console.log('Multiplayer mode...'),
  },
  { label: 'QUIT', action: () => console.log('Quitting game...') },
];

export default function MainMenu({
  className,
  items = menuItems,
  title = 'Main Menu',
  description = 'Retro 8-bit Quest',
  children,
  ...props
}: React.ComponentProps<'div'> & { items?: MainMenuItem[]; title?: React.ReactNode; description?: React.ReactNode }) {
  // ↑/↓ move between entries, like a console menu
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-menu-item]:not(:disabled)')];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const n = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[n].focus();
    e.preventDefault();
  };
  return (
    <Card className={cn(className)} {...props}>
      <CardHeader className="flex flex-col items-center justify-center gap-2">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4" role="menu" onKeyDown={onKeyDown}>
          {items.map((item) => (
            <Button key={item.id ?? item.label} role="menuitem" data-menu-item variant={item.variant} size="lg" disabled={item.disabled} onClick={item.action} title={item.hint} className="flex items-center gap-2">
              <span>{item.label}</span>
            </Button>
          ))}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

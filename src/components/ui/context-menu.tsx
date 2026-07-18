'use client';

import * as React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className = '', ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={`z-50 min-w-40 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-[var(--foreground)] shadow-xl shadow-black/15 outline-none ${className}`}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

type ContextMenuItemProps = React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean;
};

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  ContextMenuItemProps
>(({ className = '', inset, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={`relative flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium outline-none transition-colors data-[highlighted]:bg-[var(--accent)] data-[disabled]:pointer-events-none data-[disabled]:opacity-45 ${inset ? 'pl-8' : ''} ${className}`}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className = '', ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={`-mx-1 my-1 h-px bg-[var(--border)] ${className}`}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger };

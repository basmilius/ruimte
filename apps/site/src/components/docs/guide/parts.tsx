'use client';

import { FileIcon, PanelHeader, SectionLabel } from '@adecore/ui';
import { ChevronDown, ChevronRight, FileText, Folder, Hash, type LucideIcon, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { AppWindow, Rail, type RailPanel, Sidebar, type SidebarRow, TopRow } from '../../app/chrome.tsx';
import { IconButton, Separator } from '../../app/primitives.tsx';

/* The views most guide scenes show in the sidebar: a canvas with its agent, the dev server and a file. */
const VIEWS: readonly SidebarRow[] = [
    { id: 'checkout', name: 'Checkout', icon: Hash },
    { id: 'chat', name: 'Saved carts', icon: 'claude', nested: true, status: 'idle' },
    { id: 'cart', name: 'cart.ts', icon: FileText }
];

/* The window around a scene: the sidebar, the top row with the view on screen, the rail and an open panel. */
export function GuideWindow({
    view,
    rows = VIEWS,
    selected,
    panel,
    sidePanel,
    children
}: {
    readonly view?: { readonly icon: SidebarRow['icon']; readonly name: string };
    readonly rows?: readonly SidebarRow[];
    readonly selected?: string;
    readonly panel?: RailPanel;
    readonly sidePanel?: ReactNode;
    readonly children: ReactNode;
}) {
    return (
        <div className="absolute inset-0">
            <AppWindow
                sidebar={<Sidebar waiting={[]} rows={rows.map((row) => ({ ...row, selected: row.id === selected }))} />}
                toolbar={<TopRow view={view} />}
                rail={<Rail panel={panel} />}
                sidePanel={sidePanel}
            >
                {children}
            </AppWindow>
        </div>
    );
}

/*
 * A panel from the rail (`shell/Panel.tsx`): ADE CORE's 48px `PanelHeader` with the panel's name as a
 * section label, the panel's own buttons, and the close button after a separator.
 */
export function SidePanel({
    title,
    leading,
    actions,
    width = 300,
    children
}: {
    /** Left out where a chip takes the name's place, as the Git panel's branch does. */
    readonly title?: string;
    readonly leading?: ReactNode;
    readonly actions?: ReactNode;
    readonly width?: number;
    readonly children: ReactNode;
}) {
    return (
        <aside className="flex shrink-0 flex-col" style={{ width }}>
            <PanelHeader>
                {leading}
                {title !== undefined && <SectionLabel className="shrink-0">{title}</SectionLabel>}
                <span className="flex grow items-center justify-end gap-1">{actions}</span>
                {actions !== undefined && <Separator />}
                <IconButton icon={X} size="sm" />
            </PanelHeader>
            <div className="flex min-h-0 grow flex-col">{children}</div>
        </aside>
    );
}

/* A row of a file tree: a folder with its chevron, or a file with the icon its name gets everywhere in the app. */
export function TreeRow({
    name,
    depth = 0,
    folder,
    selected = false,
    trailing
}: {
    readonly name: string;
    readonly depth?: number;
    /** `open` or `closed` for a folder; left out for a file. */
    readonly folder?: 'open' | 'closed';
    readonly selected?: boolean;
    readonly trailing?: ReactNode;
}) {
    const Chevron: LucideIcon = folder === 'open' ? ChevronDown : ChevronRight;

    return (
        <div
            className={`flex h-7 items-center gap-1.5 rounded-md pr-2 text-xs ${selected ? 'bg-surface-active text-text' : 'text-text-muted'}`}
            style={{ paddingLeft: 8 + depth * 14 }}
        >
            {folder === undefined ? <span className="w-3" /> : <Chevron size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />}
            {folder === undefined ? <FileIcon path={name} size={14} /> : <Folder size={14} strokeWidth={1.75} className="shrink-0 text-text-faint" />}
            <span className="min-w-0 grow truncate">{name}</span>
            {trailing}
        </div>
    );
}

'use client';

import { Input } from '@adecore/ui';
import type { LucideIcon } from 'lucide-react';
import {
    Brain,
    Bot,
    Cable,
    ChartNoAxesColumn,
    CodeXml,
    Folder,
    Info,
    Keyboard,
    LayoutGrid,
    MessagesSquare,
    Mic,
    Palette,
    Puzzle,
    Search,
    Server,
    Settings,
    SquareTerminal
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Stage } from '../../film/Stage.tsx';

interface NavItem {
    readonly label: string;
    readonly icon: LucideIcon;
}

/* `settings/sections.ts`: the groups and their sections, About and Account at the foot. */
const GROUPS: readonly { readonly label: string | null; readonly items: readonly NavItem[] }[] = [
    {
        label: null,
        items: [
            { label: 'General', icon: Settings },
            { label: 'Appearance', icon: Palette },
            { label: 'Keyboard', icon: Keyboard }
        ]
    },
    {
        label: 'Workspace',
        items: [
            { label: 'Views', icon: LayoutGrid },
            { label: 'Editor', icon: CodeXml },
            { label: 'Terminal', icon: SquareTerminal },
            { label: 'Files and Git', icon: Folder },
            { label: 'Extensions', icon: Puzzle }
        ]
    },
    {
        label: 'AI',
        items: [
            { label: 'Providers', icon: Brain },
            { label: 'Chats', icon: MessagesSquare },
            { label: 'Agents', icon: Bot },
            { label: 'Tunnels', icon: Cable },
            { label: 'Voice', icon: Mic },
            { label: 'Usage', icon: ChartNoAxesColumn }
        ]
    }
];

/* The settings dialog of `@adecore/ui/settings` around one pane: the navigation with the section in front, and the pane's title. */
export function SettingsFrame({
    active,
    description,
    label,
    height = 760,
    children
}: {
    readonly active: string;
    readonly description: string;
    readonly label: string;
    readonly height?: number;
    readonly children: ReactNode;
}) {
    return (
        <Stage width={960} height={height} label={label}>
            <div className="absolute inset-0 flex overflow-hidden rounded-2xl border border-white/10 bg-surface-raised shadow-[0_40px_120px_-20px_rgb(0_0_0/0.8)]">
                <div className="flex w-58 shrink-0 flex-col gap-3.5 border-r border-border bg-surface bg-clip-padding px-3 py-4">
                    <div className="px-2.5 pt-1 text-lg font-semibold text-text">Settings</div>
                    <Input icon={Search} className="text-xs" placeholder="Search settings" readOnly />
                    <div className="flex min-h-0 flex-col gap-3.5">
                        {GROUPS.map((group) => (
                            <div key={group.items[0]!.label} className="flex flex-col gap-0.5">
                                {group.label !== null && <span className="px-2.5 pt-2.5 pb-1 text-xs font-medium text-text-faint">{group.label}</span>}
                                {group.items.map(({ label: item, icon: Icon }) => (
                                    <span
                                        key={item}
                                        className={`flex h-8 min-w-0 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm ${item === active ? 'bg-surface-active text-text' : 'text-text-muted'}`}
                                    >
                                        <Icon size={16} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                                        <span className="truncate">{item}</span>
                                    </span>
                                ))}
                            </div>
                        ))}
                    </div>
                    <div className="mt-auto flex flex-col gap-0.5">
                        <span className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-text-muted">
                            <Info size={16} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                            About
                        </span>
                        <span className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-text-muted">
                            <Server size={16} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                            Account
                        </span>
                    </div>
                </div>
                <div className="flex min-w-0 grow flex-col bg-bg">
                    <div className="px-8 pt-5.5 pb-4.5">
                        <h2 className="text-lg font-semibold text-text">{active}</h2>
                        <p className="mt-0.5 text-xs text-text-muted">{description}</p>
                    </div>
                    <div className="px-8">{children}</div>
                </div>
            </div>
        </Stage>
    );
}

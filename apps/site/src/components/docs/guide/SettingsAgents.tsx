'use client';

import { Input, Switch } from '@adecore/ui';
import { SettingsRow, SettingsSection } from '@adecore/ui/settings';
import type { LucideIcon } from 'lucide-react';
import {
    Brain,
    ChartNoAxesColumn,
    Bot,
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
            { label: 'Voice', icon: Mic },
            { label: 'Usage', icon: ChartNoAxesColumn }
        ]
    }
];

/* The words of `settings.agents.*` in the client. */
const ROWS = [
    { label: 'Agents may delete any view or node', description: 'When off, an agent deletes only the views and nodes it created.', on: false },
    { label: 'Agents may reach all open projects', description: 'Agents in one project can read your other open projects and start agents there.', on: false },
    {
        label: 'Continue after a usage limit',
        description: 'A chat stopped by a usage limit continues once it resets. A turn that failed on an overloaded model tries again later.',
        on: true
    },
    { label: 'Visual replies', description: 'A chart, table or mockup above a reply. When off, agents answer in text.', on: true }
] as const;

/* The settings dialog of `@adecore/ui/settings` on the Agents section, with ADE CORE's own rows and switches. */
export function SettingsAgents() {
    return (
        <Stage
            width={960}
            height={760}
            label="The Settings dialog on Agents. The navigation lists General, Appearance and Keyboard, then Workspace and AI sections. The pane shows What agents may do, with four switches."
        >
            <div className="absolute inset-0 flex overflow-hidden rounded-2xl border border-white/10 bg-surface-raised shadow-[0_40px_120px_-20px_rgb(0_0_0/0.8)]">
                <div className="flex w-58 shrink-0 flex-col gap-3.5 border-r border-border bg-surface bg-clip-padding px-3 py-4">
                    <div className="px-2.5 pt-1 text-lg font-semibold text-text">Settings</div>
                    <Input icon={Search} className="text-xs" placeholder="Search settings" readOnly />
                    <div className="flex min-h-0 flex-col gap-3.5">
                        {GROUPS.map((group) => (
                            <div key={group.items[0]!.label} className="flex flex-col gap-0.5">
                                {group.label !== null && <span className="px-2.5 pt-2.5 pb-1 text-xs font-medium text-text-faint">{group.label}</span>}
                                {group.items.map(({ label, icon: Icon }) => (
                                    <span
                                        key={label}
                                        className={`flex h-8 min-w-0 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm ${label === 'Agents' ? 'bg-surface-active text-text' : 'text-text-muted'}`}
                                    >
                                        <Icon size={16} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                                        <span className="truncate">{label}</span>
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
                        <h2 className="text-lg font-semibold text-text">Agents</h2>
                        <p className="mt-0.5 text-xs text-text-muted">What new agents start with and what they may do.</p>
                    </div>
                    <div className="px-8">
                        <SettingsSection title="What agents may do" description="Saved per machine. Applies to every device connected to it.">
                            {ROWS.map((row) => (
                                <SettingsRow
                                    key={row.label}
                                    label={row.label}
                                    description={row.description}
                                    control={<Switch checked={row.on} onCheckedChange={() => undefined} label={row.label} />}
                                />
                            ))}
                        </SettingsSection>
                    </div>
                </div>
            </div>
        </Stage>
    );
}

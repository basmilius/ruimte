'use client';

import { Button, Field, Icon, Input, Pill, SectionLabel, Switch } from '@adecore/ui';
import { MasterDetail, MasterItem, SettingsRow, SettingsSection } from '@adecore/ui/settings';
import {
    Bot,
    Brain,
    CalendarCheck,
    ChartNoAxesColumn,
    ChevronDown,
    CodeXml,
    Folder,
    HardDrive,
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
    SquareTerminal,
    Store,
    X,
    type LucideIcon
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Scaled } from '../../film/Stage.tsx';

const WIDTH = 1040;
const HEIGHT = 640;
const FIELDS_HEIGHT = 840;
const COLOR = '#0891b2';

const NAV: readonly { readonly label: string | null; readonly items: readonly (readonly [LucideIcon, string])[] }[] = [
    {
        label: null,
        items: [
            [Settings, 'General'],
            [Palette, 'Appearance'],
            [Keyboard, 'Keyboard']
        ]
    },
    {
        label: 'Workspace',
        items: [
            [LayoutGrid, 'Views'],
            [CodeXml, 'Editor'],
            [SquareTerminal, 'Terminal'],
            [Folder, 'Files and Git'],
            [Puzzle, 'Extensions']
        ]
    },
    {
        label: 'AI',
        items: [
            [Brain, 'Providers'],
            [MessagesSquare, 'Chats'],
            [Bot, 'Agents'],
            [Mic, 'Voice'],
            [ChartNoAxesColumn, 'Usage']
        ]
    }
];

const PERMISSIONS = [
    ['chats.read', 'Reads your chats to summarize them'],
    ['canvas.write', 'Writes the summary as a note']
] as const;

/* `@adecore/ui/settings` `SettingsDialog`: the sections on the left, the pane with its title on the right. */
function SettingsWindow({ children }: { readonly children: ReactNode }) {
    return (
        <div className="absolute inset-0 flex overflow-hidden rounded-[14px] border border-border bg-surface-raised text-text shadow-float">
            <div className="flex w-58 shrink-0 flex-col gap-3.5 border-r border-border bg-surface px-3 py-4">
                <span className="px-2.5 pt-1 text-base font-semibold">Settings</span>
                <span className="field relative flex items-center pl-8 text-xs text-text-faint">
                    <Icon icon={Search} size={14} className="absolute left-2.5" />
                    Search
                </span>
                <div className="flex flex-col gap-3.5">
                    {NAV.map((group) => (
                        <div key={group.label ?? 'first'} className="flex flex-col gap-0.5">
                            {group.label !== null && <span className="px-2.5 pt-2.5 pb-1 text-xs font-medium text-text-faint">{group.label}</span>}
                            {group.items.map(([glyph, label]) => (
                                <span
                                    key={label}
                                    className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm ${label === 'Extensions' ? 'bg-surface-active text-text' : 'text-text-muted'}`}
                                >
                                    <Icon icon={glyph} size={16} className="shrink-0 text-text-faint" />
                                    {label}
                                </span>
                            ))}
                        </div>
                    ))}
                </div>
                <div className="mt-auto flex flex-col gap-0.5">
                    <span className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-text-muted">
                        <Icon icon={Info} size={16} className="shrink-0 text-text-faint" />
                        About
                    </span>
                    <span className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-text-muted">
                        <Icon icon={Server} size={16} className="shrink-0 text-text-faint" />
                        Account
                    </span>
                </div>
            </div>
            <div className="flex min-w-0 grow flex-col">
                <div className="flex items-start gap-4 px-8 pt-5.5 pb-4.5">
                    <div className="min-w-0 grow">
                        <h2 className="text-lg font-semibold">Extensions</h2>
                        <p className="mt-0.5 text-xs text-text-muted">What you added to Ruimte, and the store.</p>
                    </div>
                    <span className="grid size-8 place-items-center text-text-muted">
                        <Icon icon={X} size={16} />
                    </span>
                </div>
                {children}
            </div>
        </div>
    );
}

/* `ExtensionTile`: the mark on the manifest's color. */
function Tile({ size }: { readonly size: number }) {
    return (
        <span
            className="inline-flex shrink-0 items-center justify-center text-white"
            style={{ width: size, height: size, borderRadius: Math.round(size / 4), background: COLOR }}
        >
            <Icon icon={CalendarCheck} size={Math.round(size * 0.625)} />
        </span>
    );
}

/* `ExtensionsPane`: the store and what is installed on the left, the chosen extension on the right. */
function ExtensionsPane({ selected, children }: { readonly selected: 'standup' | 'browse'; readonly children: ReactNode }) {
    return (
        <MasterDetail
            listWidth={280}
            listLabel="Extensions"
            list={
                <>
                    <MasterItem selected={selected === 'browse'} onSelect={() => undefined}>
                        <span className="inline-flex w-5 shrink-0 justify-center">
                            <Icon icon={Store} size={16} />
                        </span>
                        Browse store
                    </MasterItem>
                    <MasterItem selected={false} onSelect={() => undefined}>
                        <span className="inline-flex w-5 shrink-0 justify-center">
                            <Icon icon={HardDrive} size={16} />
                        </span>
                        Install from disk
                    </MasterItem>
                    {selected === 'standup' && (
                        <>
                            <SectionLabel className="px-3 pt-3 pb-1">In development</SectionLabel>
                            <MasterItem selected onSelect={() => undefined}>
                                <Tile size={20} />
                                Standup
                            </MasterItem>
                        </>
                    )}
                </>
            }
            detail={<div className="flex min-w-0 flex-col gap-5">{children}</div>}
        />
    );
}

function ExtensionHeader({ badge }: { readonly badge?: string }) {
    return (
        <header className="flex min-w-0 items-start gap-3">
            <Tile size={48} />
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-text">Standup</h3>
                    {badge !== undefined && <Pill>{badge}</Pill>}
                </div>
                <p className="text-xs text-text-muted">Acme, 1.2.0</p>
                <p className="mt-1 text-sm text-text-muted">Collects what every agent did since yesterday.</p>
            </div>
        </header>
    );
}

function Permissions() {
    return (
        <SettingsSection title="Asks to">
            {PERMISSIONS.map(([permission, reason]) => (
                <SettingsRow key={permission} label={reason} description={permission} control={null} />
            ))}
        </SettingsSection>
    );
}

/* A closed `Select` as its trigger draws it. */
function SelectValue({ value }: { readonly value: string }) {
    return (
        <span className="flex h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-lg border border-field-border bg-field px-2 text-xs whitespace-nowrap text-text">
            {value}
            <Icon icon={ChevronDown} size={14} className="ml-auto pl-1" />
        </span>
    );
}

function InstalledDetail({ children }: { readonly children: ReactNode }) {
    return (
        <>
            <ExtensionHeader badge="Development" />
            <SettingsSection>
                <SettingsRow label="On" control={<Switch checked disabled label="On" onCheckedChange={() => undefined} />} />
            </SettingsSection>
            <Permissions />
            {children}
        </>
    );
}

/* Settings, Extensions, with the fields of two groups as `SchemaSettings` draws them. */
export function SettingsFields() {
    return (
        <Scaled
            width={WIDTH}
            // Taller than the other scenes, so both groups show without the pane scrolling.
            height={FIELDS_HEIGHT}
            label="Settings, Extensions, with Standup selected. Under its permissions are two groups of settings: Summary with Length and Include terminals, and Schedule with Time and Weekdays only."
        >
            <SettingsWindow>
                <ExtensionsPane selected="standup">
                    <InstalledDetail>
                        <SettingsSection title="Summary">
                            <SettingsRow label="Length" description="How long a summary of a canvas gets." control={<SelectValue value="Short" />} />
                            <SettingsRow label="Include terminals" control={<Switch checked label="Include terminals" onCheckedChange={() => undefined} />} />
                        </SettingsSection>
                        <SettingsSection title="Schedule" description="When the standup note is written.">
                            <SettingsRow label="Time" control={<Input readOnly value="09:00" aria-label="Time" className="w-24" />} />
                            <SettingsRow label="Weekdays only" control={<Switch checked label="Weekdays only" onCheckedChange={() => undefined} />} />
                        </SettingsSection>
                    </InstalledDetail>
                </ExtensionsPane>
            </SettingsWindow>
        </Scaled>
    );
}

/* The same pane with a component of the extension's own under Ruimte's part, here asking for an API key. */
export function SettingsOwnPage() {
    return (
        <Scaled
            width={WIDTH}
            height={HEIGHT}
            label="Settings, Extensions, with Standup selected. Under its permissions the extension draws its own section with an API key field and a Save button."
        >
            <SettingsWindow>
                <ExtensionsPane selected="standup">
                    <InstalledDetail>
                        <Field label="Tracker API key" hint="It stays on the machine, readable only by you.">
                            <span className="flex gap-2">
                                <Input readOnly type="password" value="a-key-of-twenty" />
                                <Button variant="secondary">Save</Button>
                            </span>
                        </Field>
                    </InstalledDetail>
                </ExtensionsPane>
            </SettingsWindow>
        </Scaled>
    );
}

/* A pack from a file, before it runs: what it is, what it asks for, and Install (`FileDetail`). */
export function InstallPermissions() {
    return (
        <Scaled
            width={WIDTH}
            height={HEIGHT}
            label="Settings, Extensions, after picking a pack from a file. Standup shows its name, version and description, the two permissions it asks for with their reasons, a note that the store has not reviewed it, and Install."
        >
            <SettingsWindow>
                <ExtensionsPane selected="browse">
                    <ExtensionHeader />
                    <Permissions />
                    <p className="text-sm text-text-muted">
                        This pack comes from a file, and the store has not reviewed it. It runs inside Ruimte and can do what you can, on all your machines.
                    </p>
                    <div className="flex gap-2">
                        <Button variant="primary">Install</Button>
                        <Button>Back</Button>
                    </div>
                </ExtensionsPane>
            </SettingsWindow>
        </Scaled>
    );
}

'use client';

import type { ReactNode } from 'react';
import { FolderOpen, Laptop, MessageSquarePlus, Monitor, MonitorSmartphone, Server, type LucideIcon } from 'lucide-react';
import { SectionLabel, Tile } from '@adecore/ui';
import { AppIcon } from '../../AppIcon.tsx';
import { ProjectGlyph, TrafficLights } from '../../app/primitives.tsx';
import { Stage } from '../../film/Stage.tsx';
import { Shortcut } from '../Shortcut.tsx';

const ROW = 'flex min-h-10 w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5';

/* `MachineRow`: the hint of `linkHint` under the name, and the dot of `linkDot`. */
const MACHINES: readonly { readonly name: string; readonly icon: LucideIcon; readonly hint?: string; readonly dot: string }[] = [
    { name: 'MacBook Pro', icon: Laptop, dot: 'bg-status-idle' },
    { name: 'studio', icon: Monitor, hint: 'Connects through your account', dot: 'bg-text-faint' },
    { name: 'build-box', icon: Server, hint: 'Not connected', dot: 'bg-text-faint' }
];

const RECENT = [
    { name: 'acme-web', letter: 'A', color: '#f54900', where: 'MacBook Pro' },
    { name: 'shop-api', letter: 'S', color: '#00a63e', where: 'build-box · not connected' },
    { name: 'mobile', letter: 'M', color: '#155dfc', where: 'studio · closed' }
] as const;

/*
 * The start screen (`shell/StartScreen.tsx`): `BrandIntro`, then Start and Machines in the first column
 * and Recent in the second, with the footer's keys at the bottom.
 */
export function StartScreen() {
    return (
        <Stage
            width={1040}
            height={780}
            label="The start screen. Under Start, Open folder, New chat and Connect machine. Under Machines, this MacBook Pro, a studio that connects through your account and a build-box that is not connected. Under Recent, three projects with the machine each is on."
        >
            <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[12px] border border-white/10 bg-bg shadow-[0_40px_120px_-20px_rgb(0_0_0/0.8)]">
                <div className="flex h-12 shrink-0 items-center pl-[17px]">
                    <TrafficLights />
                </div>
                <div className="relative min-h-0 grow">
                    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-8 pt-2">
                        <header className="flex flex-col items-center gap-4 py-2 text-center">
                            <AppIcon size={72} />
                            <div className="flex flex-col items-center gap-1">
                                <h2 className="font-brand text-4xl font-semibold text-text">Ruimte</h2>
                                <p className="text-base text-text-muted">Space for AI Engineering.</p>
                            </div>
                        </header>
                        <div className="grid grid-cols-2 items-start gap-10">
                            <div className="flex min-w-0 flex-col gap-8">
                                <Section label="Start">
                                    <div className="flex flex-col gap-2">
                                        <Tile
                                            icon={<FolderOpen size={16} strokeWidth={1.75} />}
                                            title="Open folder"
                                            description="On a machine"
                                            primary
                                            tabIndex={-1}
                                        />
                                        <Tile
                                            icon={<MessageSquarePlus size={16} strokeWidth={1.75} />}
                                            title="New chat"
                                            description="A question or quick task"
                                            tabIndex={-1}
                                        />
                                        <Tile
                                            icon={<MonitorSmartphone size={16} strokeWidth={1.75} />}
                                            title="Connect machine"
                                            description="Through your account"
                                            tabIndex={-1}
                                        />
                                    </div>
                                </Section>
                                <Section label="Machines">
                                    <div className="flex flex-col gap-px">
                                        {MACHINES.map(({ name, icon: Icon, hint, dot }) => (
                                            <div key={name} className={ROW}>
                                                <Icon size={16} strokeWidth={1.75} className="shrink-0 text-text-muted" />
                                                <span className="flex min-w-0 grow flex-col">
                                                    <span className="truncate text-sm text-text">{name}</span>
                                                    {hint !== undefined && <span className="truncate text-xs text-text-faint">{hint}</span>}
                                                </span>
                                                <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
                                            </div>
                                        ))}
                                    </div>
                                </Section>
                            </div>
                            <Section label="Recent">
                                <div className="flex flex-col gap-px">
                                    {RECENT.map((project) => (
                                        <div key={project.name} className={ROW}>
                                            <ProjectGlyph letter={project.letter} color={project.color} />
                                            <span className="flex min-w-0 grow flex-col">
                                                <span className="truncate text-sm text-text">{project.name}</span>
                                                <span className="truncate text-xs text-text-faint">{project.where}</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        </div>
                    </div>
                    <footer className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-x-4 px-8 pt-10 pb-4 text-xs text-text-faint">
                        <span className="flex items-center gap-1.5">
                            <Shortcut keys="Mod+K" /> Command palette
                        </span>
                        <span className="flex items-center gap-1.5">
                            <Shortcut keys="Mod+," /> Settings
                        </span>
                    </footer>
                </div>
            </div>
        </Stage>
    );
}

function Section({ label, children }: { readonly label: string; readonly children: ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <SectionLabel className="px-2">{label}</SectionLabel>
            {children}
        </section>
    );
}

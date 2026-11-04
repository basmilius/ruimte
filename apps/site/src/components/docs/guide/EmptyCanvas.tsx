'use client';

import { SectionLabel, Tile } from '@adecore/ui';
import { ChevronRight, FileText, Globe, Hash, LayoutGrid, MessageSquare, StickyNote, Terminal, Type } from 'lucide-react';
import type { ReactNode } from 'react';
import { ClaudeMark } from '../../app/canvas.tsx';
import { Dock } from '../../app/chrome.tsx';
import { Stage } from '../../film/Stage.tsx';
import { Shortcut } from '../Shortcut.tsx';
import { GuideWindow } from './parts.tsx';

/* `empty-canvas.ts`: the sections of tiles, in the words of `canvas.empty.*`. */
const SECTIONS: readonly {
    readonly label: string;
    readonly tiles: readonly { readonly icon: ReactNode; readonly title: string; readonly description: string }[];
}[] = [
    {
        label: 'Agents',
        tiles: [
            { icon: <ClaudeMark size={16} />, title: 'Claude Code', description: 'Terminal' },
            { icon: <MessageSquare size={16} strokeWidth={1.75} />, title: 'Chat', description: 'Pick a model' }
        ]
    },
    {
        label: 'Add',
        tiles: [
            { icon: <Terminal size={16} strokeWidth={1.75} />, title: 'Terminal', description: 'Shell' },
            { icon: <Globe size={16} strokeWidth={1.75} />, title: 'Browser', description: 'Web page' },
            { icon: <FileText size={16} strokeWidth={1.75} />, title: 'File', description: 'From the project folder' },
            { icon: <StickyNote size={16} strokeWidth={1.75} />, title: 'Note', description: 'Markdown' },
            { icon: <LayoutGrid size={16} strokeWidth={1.75} />, title: 'Group', description: 'Frame around nodes' },
            { icon: <Type size={16} strokeWidth={1.75} />, title: 'Text', description: 'Or double-click' }
        ]
    }
];

/*
 * A new project's empty canvas (`canvas/EmptyCanvas.tsx`): the New chat card of `agents/ProviderRows.tsx`
 * for each chat provider, then the tiles by section, the hint, and the dock under it all.
 */
export function EmptyCanvas() {
    return (
        <Stage
            width={1040}
            height={640}
            label="The empty canvas of a new project. Under New chat, Claude Code with its model. Under Agents, a Claude Code terminal and a chat. Under Add, a terminal, a browser, a file, a note, a group and text."
        >
            <GuideWindow view={{ icon: Hash, name: 'Canvas' }} rows={[{ id: 'canvas', name: 'Canvas', icon: Hash }]} selected="canvas">
                <div className="canvas-dots absolute inset-0 grid place-items-center overflow-hidden px-4 pt-4 pb-20">
                    <div className="flex w-full max-w-[560px] flex-col gap-5">
                        <section className="flex flex-col gap-2">
                            <SectionLabel className="px-1">New chat</SectionLabel>
                            <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
                                <div className="flex w-full items-center gap-3 px-4 py-3">
                                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-sunken text-chart-claude dark:bg-field dark:inset-ring dark:inset-ring-field-border">
                                        <ClaudeMark size={20} />
                                    </span>
                                    <span className="flex min-w-0 flex-1 items-baseline gap-x-3">
                                        <span className="text-sm font-medium text-text">Claude Code</span>
                                        <span className="truncate text-xs text-text-muted">Opus 5.5</span>
                                    </span>
                                    <ChevronRight size={16} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                                </div>
                            </div>
                        </section>
                        {SECTIONS.map((section) => (
                            <section key={section.label} className="flex flex-col gap-2">
                                <SectionLabel className="px-1">{section.label}</SectionLabel>
                                <div className="grid grid-cols-3 gap-2">
                                    {section.tiles.map((tile) => (
                                        <Tile key={tile.title} icon={tile.icon} title={tile.title} description={tile.description} tabIndex={-1} />
                                    ))}
                                </div>
                            </section>
                        ))}
                        <p className="text-center text-xs text-text-muted">
                            Drop files, right-click for more, or press <Shortcut keys="Mod+K" />.
                        </p>
                    </div>
                </div>
                <div className="absolute inset-x-0 bottom-4 flex justify-center">
                    <Dock />
                </div>
            </GuideWindow>
        </Stage>
    );
}

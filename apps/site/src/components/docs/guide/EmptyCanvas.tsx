'use client';

import { Globe, Hash, MessageSquare, SquareTerminal, StickyNote, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ClaudeMark } from '../../app/canvas.tsx';
import { Dock } from '../../app/chrome.tsx';
import { Stage } from '../../film/Stage.tsx';
import { Shortcut } from '../Shortcut.tsx';
import { GuideWindow } from './parts.tsx';

/* `canvas/empty-canvas.ts`: where each ghost stands, in canvas units. */
const GHOSTS: readonly {
    readonly title: string;
    readonly icon: LucideIcon;
    readonly keys: string;
    readonly frame: readonly [number, number, number, number];
}[] = [
    { title: 'Chat', icon: MessageSquare, keys: 'Alt+C', frame: [0, 0, 432, 312] },
    { title: 'Terminal', icon: SquareTerminal, keys: 'Alt+T', frame: [456, 0, 336, 144] },
    { title: 'Browser', icon: Globe, keys: 'Alt+B', frame: [456, 168, 156, 144] },
    { title: 'Note', icon: StickyNote, keys: 'Alt+N', frame: [636, 168, 156, 144] }
];

function FaintLine({ className }: { readonly className: string }) {
    return <span className={`h-2 shrink-0 rounded-sm bg-text/6 ${className}`} />;
}

function AgentButton({ size }: { readonly size: 'md' | 'sm' }) {
    return (
        <span
            className={`grid shrink-0 place-items-center border border-field-border bg-field text-chart-claude ${size === 'md' ? 'size-9 rounded-lg' : 'size-7 rounded-md'}`}
        >
            <ClaudeMark size={size === 'md' ? 18 : 14} />
        </span>
    );
}

const BODIES: Record<string, ReactNode> = {
    Chat: (
        <>
            <span className="self-end rounded-xl border-2 border-dashed border-text/15 px-3 py-2.5">
                <FaintLine className="block w-30" />
            </span>
            <span className="flex flex-col gap-2">
                <FaintLine className="w-7/8" />
                <FaintLine className="w-3/4" />
                <FaintLine className="w-1/2" />
            </span>
            <p className="mt-auto">Pick an agent to start</p>
            <span className="flex gap-1.5">
                <AgentButton size="md" />
            </span>
        </>
    ),
    Terminal: (
        <>
            <span className="font-mono text-text-faint">
                $ <span className="inline-block h-4 w-2 bg-current align-middle opacity-60" />
            </span>
            <span className="mt-auto flex items-center gap-1.5">
                <span className="mr-1">Or run</span>
                <AgentButton size="sm" />
            </span>
        </>
    ),
    Browser: (
        <>
            <span className="h-7 shrink-0 rounded-md bg-text/5" />
            <FaintLine className="w-3/4" />
            <FaintLine className="w-1/2" />
        </>
    ),
    Note: (
        <>
            <FaintLine className="w-4/5" />
            <FaintLine className="w-3/5" />
            <FaintLine className="w-2/3" />
        </>
    )
};

/*
 * A new project's empty canvas (`canvas/EmptyCanvas.tsx`): a ghost of a chat, a terminal, a browser and
 * a note, the hint under them, and the dock under it all.
 */
export function EmptyCanvas() {
    return (
        <Stage
            width={1040}
            height={640}
            label="The empty canvas of a new project: dashed outlines of a chat, a terminal, a browser and a note. The chat says Pick an agent to start, above a Claude Code button; the terminal offers Claude Code under Or run."
        >
            <GuideWindow view={{ icon: Hash, name: 'Canvas' }} rows={[{ id: 'canvas', name: 'Canvas', icon: Hash }]} selected="canvas">
                <div className="canvas-dots absolute inset-0 flex flex-col items-center justify-center gap-6 overflow-hidden px-6 pt-4 pb-20">
                    <div className="relative shrink-0" style={{ width: 792, height: 312 }}>
                        {GHOSTS.map(({ title, icon: GhostIcon, keys, frame: [x, y, w, h] }) => (
                            <div
                                key={title}
                                className="absolute flex flex-col rounded-xl border-2 border-dashed border-text/15 text-xs text-text-muted"
                                style={{ left: x, top: y, width: w, height: h }}
                            >
                                <div className="flex h-10 shrink-0 items-center gap-2 px-2.5">
                                    <GhostIcon size={16} strokeWidth={1.75} />
                                    <span className="font-medium text-text">{title}</span>
                                    <span className="ml-auto text-text-faint">
                                        <Shortcut keys={keys} />
                                    </span>
                                </div>
                                <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">{BODIES[title]}</div>
                            </div>
                        ))}
                    </div>
                    <p className="text-center text-xs text-text-muted">
                        Drop files, right-click for more, or press <Shortcut keys="Mod+K" />.
                    </p>
                </div>
                <div className="absolute inset-x-0 bottom-4 flex justify-center">
                    <Dock />
                </div>
            </GuideWindow>
        </Stage>
    );
}

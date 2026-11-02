'use client';

import type { ReactNode } from 'react';
import { FileText, Hash, Terminal } from 'lucide-react';
import { motion } from 'motion/react';
import { TerminalBody } from '../../app/bodies.tsx';
import { StatusDot } from '../../app/canvas.tsx';
import { AssistantText, UserBubble } from '../../app/chat.tsx';
import { AppWindow, CellToolbar, Rail, Sidebar, type SidebarRow, TopRow } from '../../app/chrome.tsx';
import { EASE, useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1800, 1800, 4400] as const;

type Cell = 'chat' | 'dev' | 'canvas' | 'file';

// A type, not an interface: motion's `animate` takes only a shape with an implicit index signature.
type Box = {
    readonly left: string;
    readonly top: string;
    readonly width: string;
    readonly height: string;
};

const FULL = '100%';
const HALF = 'calc(50% - 0.5px)';
const SECOND = 'calc(50% + 0.5px)';

/* One cell, then split right, then split down: the grid is cells on a 1px line, with no gap. */
function layout(step: number): Record<Cell, Box> {
    const hidden = { left: FULL, top: '0%', width: HALF, height: FULL };

    if (step === 0) {
        return { chat: { left: '0%', top: '0%', width: FULL, height: FULL }, dev: hidden, canvas: { ...hidden, top: FULL }, file: { ...hidden, top: FULL } };
    }

    if (step === 1) {
        return {
            chat: { left: '0%', top: '0%', width: HALF, height: FULL },
            dev: { left: SECOND, top: '0%', width: HALF, height: FULL },
            canvas: { left: '0%', top: FULL, width: HALF, height: HALF },
            file: { left: SECOND, top: FULL, width: HALF, height: HALF }
        };
    }

    return {
        chat: { left: '0%', top: '0%', width: HALF, height: HALF },
        dev: { left: SECOND, top: '0%', width: HALF, height: HALF },
        canvas: { left: '0%', top: SECOND, width: HALF, height: HALF },
        file: { left: SECOND, top: SECOND, width: HALF, height: HALF }
    };
}

const CELLS: readonly { readonly id: Cell; readonly icon: SidebarRow['icon']; readonly name: string }[] = [
    { id: 'chat', icon: 'claude', name: 'Saved carts' },
    { id: 'dev', icon: Terminal, name: 'dev server' },
    { id: 'canvas', icon: Hash, name: 'Checkout' },
    { id: 'file', icon: FileText, name: 'cart.ts' }
];

/* Four views at once: a chat, split right for the dev server, then split down for a canvas and a file. */
export function GridCells() {
    return (
        <Stage
            width={960}
            height={560}
            label="A window that shows one chat, then splits right for a terminal, then splits down again, until four views sit side by side in a grid: a chat, the dev server, a canvas and a file."
        >
            <GridScene />
        </Stage>
    );
}

function GridScene() {
    const step = useTimeline(STEPS);
    const boxes = layout(step);
    const many = step >= 1;

    return (
        <div className="absolute inset-0">
            <AppWindow
                sidebar={
                    <Sidebar
                        waiting={[]}
                        rows={[
                            { id: 'checkout', name: 'Checkout', icon: Hash, beside: step === 2 },
                            { id: 'chat', name: 'Saved carts', icon: 'claude', status: 'running', selected: true },
                            { id: 'dev', name: 'dev server', icon: Terminal, status: 'running', beside: many },
                            { id: 'file', name: 'cart.ts', icon: FileText, beside: step === 2 }
                        ]}
                    />
                }
                toolbar={<TopRow view={many ? undefined : { icon: 'claude', name: 'Saved carts' }} />}
                rail={<Rail />}
            >
                <div className="absolute inset-0 overflow-hidden bg-border">
                    {CELLS.map((cell) => (
                        <motion.div
                            key={cell.id}
                            className="absolute flex flex-col overflow-hidden bg-surface"
                            initial={false}
                            animate={boxes[cell.id]}
                            transition={{ duration: 0.55, ease: EASE }}
                        >
                            {many && <CellToolbar icon={cell.icon} name={cell.name} focused={cell.id === 'chat'} />}
                            <div className="relative min-h-0 grow">
                                <CellBody cell={cell.id} />
                            </div>
                        </motion.div>
                    ))}
                </div>
            </AppWindow>
        </div>
    );
}

function CellBody({ cell }: { readonly cell: Cell }): ReactNode {
    switch (cell) {
        case 'chat':
            return (
                <div className="flex flex-col gap-3 px-5 pt-4">
                    <UserBubble>Keep a saved cart for 30 days.</UserBubble>
                    <AssistantText shown text="Adding an expiry to the carts table, then a test for it." />
                    <div className="flex items-center gap-2 text-[13px] text-text-muted">
                        <StatusDot status="running" /> Working
                    </div>
                </div>
            );
        case 'dev':
            return (
                <TerminalBody>
                    <div>
                        <span className="text-ansi-green">~/acme-web</span> <span className="text-term-dim">$</span> bun dev
                    </div>
                    <div> </div>
                    <div>
                        {'  '}
                        <span className="text-ansi-green">➜</span> Local: <span className="text-ansi-cyan">http://localhost:5173/</span>
                    </div>
                </TerminalBody>
            );
        case 'canvas':
            return (
                <div className="canvas-dots absolute inset-0">
                    <span className="absolute top-5 left-5 h-20 w-32 rounded-xl border border-border bg-note-yellow shadow-node" />
                    <span className="absolute top-9 left-44 h-28 w-36 rounded-xl border border-border bg-surface shadow-node" />
                </div>
            );
        case 'file':
            return (
                <div className="space-y-1 bg-surface-sunken px-4 py-3 font-mono text-[13px] leading-5 text-text-muted">
                    <div>
                        <span className="text-ansi-magenta">export function</span> <span className="text-ansi-blue">expiresAt</span>(cart) {'{'}
                    </div>
                    <div className="pl-4">
                        <span className="text-ansi-magenta">return</span> cart.savedAt + DAYS_30;
                    </div>
                    <div>{'}'}</div>
                </div>
            );
    }
}

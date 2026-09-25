'use client';

import { useEffect, useState } from 'react';
import { Globe, PenTool, Terminal } from 'lucide-react';
import { motion } from 'motion/react';
import { TerminalBody } from '../app/bodies.tsx';
import { AssistantText, Composer, ToolRow, UserBubble } from '../app/chat.tsx';
import { CellToolbar, type SidebarRow } from '../app/chrome.tsx';
import { Sketch } from '../app/drawing.tsx';
import { Reveal } from '../app/primitives.tsx';
import { EASE, usePlayback } from './playback.ts';

const WIDTH = 1032;
const HEIGHT = 752;

type Cell = 'chat' | 'logs' | 'drawing' | 'docs';

interface Box {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

const HALF_W = (WIDTH - 1) / 2;
const HALF_H = (HEIGHT - 1) / 2;

// The grid is cells on a 1px line of the border color, no gap and no padding (`SplitGrid.tsx`).
function layout(step: number): Record<Cell, Box> {
    if (step === 0) {
        return {
            chat: { x: 0, y: 0, w: WIDTH, h: HEIGHT },
            logs: { x: WIDTH, y: 0, w: HALF_W, h: HEIGHT },
            drawing: { x: 0, y: HEIGHT, w: HALF_W, h: HALF_H },
            docs: { x: WIDTH, y: HEIGHT, w: HALF_W, h: HALF_H }
        };
    }
    if (step === 1) {
        return {
            chat: { x: 0, y: 0, w: HALF_W, h: HEIGHT },
            logs: { x: HALF_W + 1, y: 0, w: HALF_W, h: HEIGHT },
            drawing: { x: 0, y: HEIGHT, w: HALF_W, h: HALF_H },
            docs: { x: HALF_W + 1, y: HEIGHT, w: HALF_W, h: HALF_H }
        };
    }
    return {
        chat: { x: 0, y: 0, w: HALF_W, h: HALF_H },
        logs: { x: HALF_W + 1, y: 0, w: HALF_W, h: HALF_H },
        drawing: { x: 0, y: HALF_H + 1, w: HALF_W, h: HALF_H },
        docs: { x: HALF_W + 1, y: HALF_H + 1, w: HALF_W, h: HALF_H }
    };
}

const CELLS: readonly { readonly id: Cell; readonly icon: SidebarRow['icon']; readonly name: string }[] = [
    { id: 'chat', icon: 'claude', name: 'Fix signup' },
    { id: 'logs', icon: Terminal, name: 'logs' },
    { id: 'drawing', icon: PenTool, name: 'Architecture' },
    { id: 'docs', icon: Globe, name: 'Docs' }
];

export function GridChapter({ step }: { readonly step: number }) {
    const boxes = layout(step);
    const focused: Cell = step >= 4 ? 'drawing' : 'chat';
    const many = step >= 1;

    return (
        <div className="absolute inset-0 overflow-hidden bg-border">
            {CELLS.map(({ id, icon, name }) => {
                const box = boxes[id];
                return (
                    <motion.div
                        key={id}
                        className="absolute flex flex-col overflow-hidden bg-bg"
                        initial={false}
                        animate={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                        transition={{ duration: 0.6, ease: EASE }}
                    >
                        {many && <CellToolbar icon={icon} name={name} focused={focused === id} />}
                        <div className="relative min-h-0 grow">
                            {id === 'chat' && <ChatView step={step} wide={!many} />}
                            {id === 'logs' && <Logs />}
                            {id === 'drawing' && (
                                <div className="canvas-dots absolute inset-0">
                                    <Sketch step={step >= 3 ? 6 : 0} scale={0.78} offset={[14, -10]} />
                                </div>
                            )}
                            {id === 'docs' && <Docs />}
                        </div>
                    </motion.div>
                );
            })}
        </div>
    );
}

/** A chat standing as a view of its own: the thread in a centered column over the composer. */
function ChatView({ step, wide }: { readonly step: number; readonly wide: boolean }) {
    return (
        <div className="absolute inset-0 flex flex-col bg-bg">
            <div className={`mx-auto flex w-full grow flex-col gap-4 overflow-hidden px-5 pt-5 ${wide ? 'max-w-[768px]' : ''}`}>
                <UserBubble>Fix the bug in the note and check it in the browser.</UserBubble>
                <div>
                    <ToolRow tool="read" label="Read" detail="src/SignupForm.tsx" />
                    <ToolRow tool="edit" label="Edit" detail="src/SignupForm.tsx" />
                </div>
                <AssistantText shown text="Committed. The email now survives a failed submit." />
            </div>
            <div className={`mx-auto w-full px-3 pb-3 ${wide ? 'max-w-[768px]' : ''}`}>
                <Composer draft={step >= 3 ? 'Add a test for an empty email too' : undefined} typing={step === 3} />
            </div>
        </div>
    );
}

const LOG = [
    ['GET', '/api/signup', '201', '38ms'],
    ['GET', '/signup', '200', '4ms'],
    ['POST', '/api/signup', '422', '12ms'],
    ['POST', '/api/signup', '201', '41ms'],
    ['GET', '/api/session', '200', '3ms'],
    ['GET', '/dashboard', '200', '6ms']
] as const;

function Logs() {
    const { playing } = usePlayback();
    const [tick, setTick] = useState(40);

    useEffect(() => {
        if (!playing) {
            return;
        }
        const timer = window.setInterval(() => setTick((current) => current + 1), 520);
        return () => window.clearInterval(timer);
    }, [playing]);

    const lines = Array.from({ length: 22 }, (_, i) => tick - 22 + i);
    return (
        <TerminalBody>
            {lines.map((line) => {
                const [method, path, code, time] = LOG[line % LOG.length];
                const seconds = String(line % 60).padStart(2, '0');
                return (
                    <div key={line}>
                        <span className="text-term-dim">
                            12:0{Math.floor(line / 60) % 10}:{seconds}
                        </span>{' '}
                        <span className="text-ansi-blue">{method.padEnd(4)}</span> {path.padEnd(14)}{' '}
                        <span className={code.startsWith('4') ? 'text-ansi-yellow' : 'text-ansi-green'}>{code}</span>{' '}
                        <span className="text-term-dim">{time}</span>
                    </div>
                );
            })}
        </TerminalBody>
    );
}

function Docs() {
    return (
        <div className="absolute inset-0 flex flex-col">
            <div className="flex h-[37px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3">
                <span className="flex h-7 grow items-center rounded-md border border-border-soft bg-surface-sunken px-2.5 text-[14px] text-text">
                    docs.acme.dev/forms
                </span>
            </div>
            <div className="grow space-y-3 bg-white p-6 text-[#18181b]">
                <div className="text-[20px] font-semibold">Forms</div>
                <Reveal shown className="space-y-2 text-[13px] leading-5 text-[#52525b]">
                    <p>Keep the values a person typed until the server answers. Reset a form only after a request succeeds.</p>
                    <div className="rounded-md bg-[#f4f4f5] p-3 font-mono text-[12px] whitespace-pre text-[#18181b]">
                        {'if (response.ok) {\n  form.reset();\n}'}
                    </div>
                </Reveal>
            </div>
        </div>
    );
}

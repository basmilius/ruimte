'use client';

import { FileText, Hash, LayoutGrid, MessageSquare, Plus, Sparkles, StickyNote, Terminal } from 'lucide-react';
import { CanvasNode } from '../../app/canvas.tsx';
import { TerminalBody } from '../../app/bodies.tsx';
import { AppWindow, Dock, FLOAT, Rail, Sidebar, TopRow } from '../../app/chrome.tsx';
import { Button, IconButton, Separator } from '../../app/primitives.tsx';
import { usePlayback, useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';
import { SlotSpot } from './slot-parts.tsx';

const SLOTS = ['viewToolbar', 'nodeHeader', 'selectionBar', 'canvasMenu', 'sidebarFooter'] as const;
const STEPS = SLOTS.map(() => 1800);

const NOTE = { x: 36, y: 36, w: 264, h: 160 };
const TERMINAL = { x: 340, y: 36, w: 280, h: 160 };

/* Ruimte with five of the places an extension adds to, each lit in its turn. */
export function SlotMap() {
    return (
        <Stage
            width={960}
            height={560}
            label="A Ruimte window with five slots marked: the view's toolbar, a node's header, the selection bar, the canvas menu and the sidebar's footer."
        >
            <SlotMapScene />
        </Stage>
    );
}

function SlotMapScene() {
    const step = useTimeline(STEPS);
    const { still } = usePlayback();
    const lit = (slot: (typeof SLOTS)[number]) => still || SLOTS[step] === slot;

    return (
        <div className="absolute inset-0">
            <AppWindow
                sidebar={
                    <Sidebar
                        waiting={[]}
                        rows={[
                            { id: 'signup', name: 'Signup', icon: Hash, selected: true },
                            { id: 'brief', name: 'Brief', icon: StickyNote, nested: true },
                            { id: 'tests', name: 'tests', icon: Terminal, nested: true, status: 'idle' },
                            { id: 'review', name: 'Review', icon: 'claude', status: 'running' },
                            'separator',
                            { id: 'readme', name: 'README.md', icon: FileText }
                        ]}
                    />
                }
                toolbar={<TopRow view={{ icon: Hash, name: 'Signup' }} />}
                rail={<Rail />}
            >
                <div className="canvas-dots absolute inset-0">
                    <CanvasNode rect={NOTE} kind="note" title="Brief" selected>
                        <div className="px-3 py-2.5 text-[14px] leading-[21px]">
                            <p className="font-semibold">Signup keeps the email.</p>
                            <p className="mt-2 text-text-muted">A failed submit must not clear what a person typed.</p>
                        </div>
                    </CanvasNode>
                    <CanvasNode rect={TERMINAL} kind="terminal" title="tests" status="idle" selected>
                        <TerminalBody>
                            <div className="text-term-dim">$ bun test signup</div>
                            <div className="mt-2 text-ansi-green">✓ keeps the email</div>
                            <div className="text-ansi-green">✓ shows the error</div>
                        </TerminalBody>
                    </CanvasNode>
                    <div className={`absolute top-[250px] left-[430px] z-10 flex w-[208px] flex-col rounded-xl p-1 text-[13px] text-text ${FLOAT}`}>
                        <span className="flex h-8 items-center gap-2 rounded-md px-2">
                            <Plus size={14} strokeWidth={1.75} className="text-text-muted" />
                            New node
                        </span>
                        <span className="flex h-8 items-center gap-2 rounded-md px-2">
                            <LayoutGrid size={14} strokeWidth={1.75} className="text-text-muted" />
                            Arrange
                        </span>
                        <span className="mx-2 my-1 h-px bg-border" />
                        <span className="h-8" />
                    </div>
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                        <Dock working={1} />
                    </div>
                </div>
            </AppWindow>
            <SlotSpot name="viewToolbar" lit={lit('viewToolbar')} x={822} y={10} width={30} height={28}>
                <IconButton icon={Sparkles} size="sm" className="text-accent" />
            </SlotSpot>
            <SlotSpot name="nodeHeader" lit={lit('nodeHeader')} x={248 + NOTE.x + NOTE.w - 96} y={47 + NOTE.y + 6} width={28} height={28}>
                <IconButton icon={Sparkles} size="sm" className="text-accent" />
            </SlotSpot>
            <SlotSpot name="selectionBar" lit={lit('selectionBar')} x={248 + 210} y={47 + 380} width={230} height={40} labelBelow={false}>
                <div className={`flex h-10 items-center gap-1 rounded-xl px-1 text-[13px] ${FLOAT}`}>
                    <span className="px-2 text-text-muted">2 selected</span>
                    <Separator />
                    <Button size="sm" className="text-text">
                        <Sparkles size={14} strokeWidth={1.75} className="text-accent" />
                        Summarize
                    </Button>
                </div>
            </SlotSpot>
            <SlotSpot name="canvasMenu" lit={lit('canvasMenu')} x={248 + 434} y={47 + 326} width={200} height={32} labelBelow>
                <span className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-text">
                    <MessageSquare size={14} strokeWidth={1.75} className="text-accent" />
                    Ask about this canvas
                </span>
            </SlotSpot>
            <SlotSpot name="sidebarFooter" lit={lit('sidebarFooter')} x={10} y={560 - 44} width={120} height={32}>
                <span className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-text-muted">
                    <Sparkles size={14} strokeWidth={1.75} className="text-accent" />
                    Standup
                </span>
            </SlotSpot>
        </div>
    );
}

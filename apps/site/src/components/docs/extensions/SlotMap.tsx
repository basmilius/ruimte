'use client';

import { FileText, Hash, MessageSquare, Scan, Maximize, Sparkles, StickyNote, Terminal } from 'lucide-react';
import { Icon, Kbd } from '@adecore/ui';
import { CanvasNode } from '../../app/canvas.tsx';
import { TerminalBody } from '../../app/bodies.tsx';
import { AppWindow, Dock, Rail, Sidebar, TopRow } from '../../app/chrome.tsx';
import { Button, IconButton } from '../../app/primitives.tsx';
import { usePlayback, useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';
import { NoteText, SelectionBar, SlotSpot } from './parts.tsx';

const SLOTS = ['viewToolbar', 'nodeHeader', 'selectionBar', 'canvasMenu', 'sidebarFooter'] as const;
const STEPS = SLOTS.map(() => 1800);

const NOTE = { x: 28, y: 68, w: 264, h: 156 };
const TERMINAL = { x: 324, y: 68, w: 300, h: 156 };

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
                        footer={
                            <SlotSpot name="sidebarFooter" lit={lit('sidebarFooter')} labelEnd>
                                <IconButton icon={Sparkles} />
                            </SlotSpot>
                        }
                    />
                }
                toolbar={
                    <TopRow
                        view={{ icon: Hash, name: 'Signup' }}
                        trailing={
                            <SlotSpot name="viewToolbar" lit={lit('viewToolbar')} labelBelow labelEnd>
                                <IconButton icon={Sparkles} size="sm" />
                            </SlotSpot>
                        }
                    />
                }
                rail={<Rail />}
            >
                <div className="canvas-dots absolute inset-0">
                    <CanvasNode rect={NOTE} kind="note" title="Brief" selected>
                        <NoteText>
                            <p className="font-semibold">Signup keeps the email.</p>
                            <p className="mt-2 text-text-muted">A failed submit must not clear what a person typed.</p>
                        </NoteText>
                    </CanvasNode>
                    <CanvasNode
                        rect={TERMINAL}
                        kind="terminal"
                        title="tests"
                        selected
                        actions={
                            <SlotSpot name="nodeHeader" lit={lit('nodeHeader')} labelBelow labelEnd>
                                <IconButton icon={Sparkles} size="sm" />
                            </SlotSpot>
                        }
                    >
                        <TerminalBody>
                            <div className="text-term-dim">$ bun test signup</div>
                            <div className="mt-2 text-ansi-green">✓ keeps the email</div>
                            <div className="text-ansi-green">✓ shows the error</div>
                        </TerminalBody>
                    </CanvasNode>
                    <SelectionBar>
                        <SlotSpot name="selectionBar" lit={lit('selectionBar')} labelBelow>
                            <Button>
                                <Sparkles size={14} strokeWidth={1.75} />
                                Summarize
                            </Button>
                        </SlotSpot>
                    </SelectionBar>
                    <CanvasMenu lit={lit('canvasMenu')} />
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                        <Dock working={1} />
                    </div>
                </div>
            </AppWindow>
        </div>
    );
}

/* `canvas/CanvasMenu.tsx`, shortened: what to add, what to do with the canvas, then the `canvasMenu` slot under a separator. */
function CanvasMenu({ lit }: { readonly lit: boolean }) {
    return (
        // Visible overflow, so the label of the slot can hang under the menu.
        <div className="menu-popup absolute top-[250px] left-[408px] z-10 flex w-[224px] flex-col overflow-visible">
            <span className="menu-item">
                <Icon icon={Terminal} size={14} /> Terminal <Kbd>⌥T</Kbd>
            </span>
            <span className="menu-item">
                <Icon icon={MessageSquare} size={14} /> Chat <Kbd>⌥C</Kbd>
            </span>
            <span role="separator" className="-mx-1 my-1 h-px bg-border-soft" />
            <span className="menu-item">
                <Icon icon={Scan} size={14} /> Select all <Kbd>⌘A</Kbd>
            </span>
            <span className="menu-item">
                <Icon icon={Maximize} size={14} /> Zoom to fit <Kbd>⇧1</Kbd>
            </span>
            <span role="separator" className="-mx-1 my-1 h-px bg-border-soft" />
            <SlotSpot name="canvasMenu" lit={lit} labelBelow>
                <span className="menu-item grow">
                    <Icon icon={Sparkles} size={14} /> Ask about this canvas
                </span>
            </SlotSpot>
        </div>
    );
}

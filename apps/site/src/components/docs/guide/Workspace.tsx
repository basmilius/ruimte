'use client';

import { Hash, StickyNote, Terminal } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { TerminalBody } from '../../app/bodies.tsx';
import { CanvasEdge, CanvasNode } from '../../app/canvas.tsx';
import { ApprovalCard, AssistantText, PromptStack, ToolRow, UserBubble, WorkingRow } from '../../app/chat.tsx';
import { AppWindow, Dock, Rail, Sidebar, TopRow } from '../../app/chrome.tsx';
import { EASE, useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1600, 2600, 4400] as const;
const NOTE = { x: 24, y: 36, w: 212, h: 132 };
const TERMINAL = { x: 24, y: 214, w: 212, h: 150 };
const CHAT = { x: 284, y: 24, w: 356, h: 360 };

/* A project in the window: its views in the sidebar, a canvas with a note and a terminal linked into a chat, and the chat asking for permission. */
export function Workspace() {
    return (
        <Stage
            width={960}
            height={560}
            label="A project in Ruimte. The sidebar lists its views. On the canvas, a note and a terminal have lines into a chat. The chat asks to run a command, and it shows up under Needs you."
        >
            <WorkspaceScene />
        </Stage>
    );
}

function WorkspaceScene() {
    const step = useTimeline(STEPS);
    const waiting = step === 2;

    return (
        <div className="absolute inset-0">
            <AppWindow
                sidebar={
                    <Sidebar
                        waiting={waiting ? [{ id: 'waiting', name: 'Saved carts', icon: 'claude', view: 'Checkout', status: 'needs-you' }] : []}
                        rows={[
                            { id: 'checkout', name: 'Checkout', icon: Hash, selected: true },
                            { id: 'brief', name: 'Brief', icon: StickyNote, nested: true },
                            { id: 'tests', name: 'tests', icon: Terminal, nested: true },
                            { id: 'chat', name: 'Saved carts', icon: 'claude', nested: true, status: waiting ? 'needs-you' : 'running' },
                            { id: 'dev', name: 'dev server', icon: Terminal }
                        ]}
                    />
                }
                toolbar={<TopRow view={{ icon: Hash, name: 'Checkout' }} />}
                rail={<Rail />}
            >
                <div className="canvas-dots absolute inset-0 overflow-hidden">
                    <CanvasEdge from={NOTE} to={CHAT} look="context" />
                    <CanvasEdge from={TERMINAL} to={CHAT} look="context" />
                    <CanvasNode rect={NOTE} kind="note" title="Brief">
                        <div className="px-3 py-2.5 text-[14px] leading-[21px] text-text">Keep a saved cart for 30 days. Restore it after sign-in.</div>
                    </CanvasNode>
                    <CanvasNode rect={TERMINAL} kind="terminal" title="tests">
                        <TerminalBody>
                            <div>
                                <span className="text-ansi-green">~/acme-web</span> <span className="text-term-dim">$</span> bun test
                            </div>
                            <div> </div>
                            <div>
                                <span className="text-ansi-green">50 pass</span>
                            </div>
                            <div>
                                <span className="text-term-dim">0 fail</span>
                            </div>
                        </TerminalBody>
                    </CanvasNode>
                    <CanvasNode rect={CHAT} kind="chat" agent title="Saved carts" status={waiting ? 'needs-you' : 'running'}>
                        <div className="flex flex-col gap-3 px-4 pt-4">
                            <UserBubble>Build saved carts from the brief, and push when the tests pass.</UserBubble>
                            <ToolRow tool="read" label="Read" detail="Brief" />
                            <ToolRow tool="edit" label="Edit" detail="src/cart.ts" live={step === 0} />
                            <AssistantText shown={step >= 1} text="Saved carts work and the tests pass. Pushing the branch now." />
                            {!waiting && <WorkingRow seconds={step * 9 + 14} />}
                        </div>
                    </CanvasNode>
                    <AnimatePresence>
                        {waiting && (
                            <motion.div
                                className="absolute inset-x-0 bottom-16 flex justify-center px-6"
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                transition={{ duration: 0.4, ease: EASE }}
                            >
                                <div className="w-full max-w-[576px]">
                                    <PromptStack title="Saved carts" status="needs-you" meta="Claude Code · chat · 12:05">
                                        <ApprovalCard cwd="~/acme-web" command="git push origin saved-carts" />
                                    </PromptStack>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <div className="absolute inset-x-0 bottom-4 flex justify-center">
                        <Dock waiting={waiting ? 1 : 0} working={waiting ? 0 : 1} />
                    </div>
                </div>
            </AppWindow>
        </div>
    );
}

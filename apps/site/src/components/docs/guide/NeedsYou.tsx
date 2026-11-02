'use client';

import { ArrowUp, Circle, CircleCheck, Hash, MessageCircleQuestionMark, Terminal } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CanvasNode } from '../../app/canvas.tsx';
import { AssistantText, PromptStack, WorkingRow } from '../../app/chat.tsx';
import { AppWindow, Dock, Rail, Sidebar, type SidebarRow, TopRow } from '../../app/chrome.tsx';
import { Button } from '../../app/primitives.tsx';
import { EASE, useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1600, 2200, 400, 4000] as const;
const CHOICES = ['Keep for 30 days', 'Clear on sign-out', 'Something else…'] as const;
const OTHERS: readonly SidebarRow[] = [
    { id: 'release', name: 'Release', icon: 'claude', status: 'needs-you' },
    { id: 'docs', name: 'Docs agent', icon: Terminal, status: 'needs-you' }
];

/* What waits on you, listed in the sidebar, with the oldest question answered right on the canvas. */
export function NeedsYou() {
    return (
        <Stage
            width={960}
            height={560}
            label="Three agents wait, listed under Needs you in the sidebar. The question of the first one shows on the canvas with its choices. You pick Keep for 30 days and press Answer; the agent goes back to work and leaves the list."
        >
            <NeedsYouScene />
        </Stage>
    );
}

function NeedsYouScene() {
    const step = useTimeline(STEPS);
    const answered = step === 3;
    const waiting: readonly SidebarRow[] = answered ? OTHERS : [{ id: 'carts', name: 'Saved carts', icon: 'claude', status: 'needs-you' }, ...OTHERS];

    return (
        <div className="absolute inset-0">
            <AppWindow
                sidebar={
                    <Sidebar
                        waiting={waiting}
                        rows={[
                            { id: 'checkout', name: 'Checkout', icon: Hash, selected: true },
                            { id: 'carts', name: 'Saved carts', icon: 'claude', nested: true, status: answered ? 'running' : 'needs-you' },
                            { id: 'release', name: 'Release', icon: 'claude', status: 'needs-you' },
                            { id: 'docs', name: 'Docs agent', icon: Terminal, status: 'needs-you' }
                        ]}
                    />
                }
                toolbar={<TopRow view={{ icon: Hash, name: 'Checkout' }} />}
                rail={<Rail />}
            >
                <div className="canvas-dots absolute inset-0 overflow-hidden">
                    <CanvasNode rect={{ x: 32, y: 28, w: 420, h: 150 }} kind="chat" agent title="Saved carts" status={answered ? 'running' : 'needs-you'}>
                        <div className="flex flex-col gap-3 px-4 py-3">
                            <AssistantText shown text="The cart now survives sign-in. How long should it stay?" />
                            {answered && <WorkingRow seconds={4} />}
                        </div>
                    </CanvasNode>
                    <AnimatePresence>
                        {!answered && (
                            <motion.div
                                className="absolute inset-x-0 bottom-16 flex justify-center px-6"
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                transition={{ duration: 0.4, ease: EASE }}
                            >
                                <div className="w-full max-w-[480px]">
                                    <PromptStack title="Saved carts" status="needs-you" meta="Claude · chat · 12:04">
                                        <div className="flex flex-col gap-2 p-3">
                                            <div className="flex items-start gap-2">
                                                <MessageCircleQuestionMark size={16} strokeWidth={1.75} className="mt-[3px] shrink-0 text-status-needs-you" />
                                                <h3 className="text-[14px] leading-[21px] font-semibold">How long should a saved cart stay?</h3>
                                            </div>
                                            {CHOICES.map((choice, i) => {
                                                const selected = step >= 1 && i === 0;
                                                const Mark = selected ? CircleCheck : Circle;

                                                return (
                                                    <div
                                                        key={choice}
                                                        className={`flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-hover'}`}
                                                    >
                                                        <Mark size={16} strokeWidth={1.75} className="shrink-0 text-text-muted" />
                                                        {choice}
                                                    </div>
                                                );
                                            })}
                                            <div className="flex justify-end pt-1">
                                                <Button variant="inverse" className={step === 2 ? 'scale-[0.96]' : ''}>
                                                    Answer <ArrowUp size={16} strokeWidth={1.75} />
                                                </Button>
                                            </div>
                                        </div>
                                    </PromptStack>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <div className="absolute inset-x-0 bottom-4 flex justify-center">
                        <Dock waiting={waiting.length} working={answered ? 1 : 0} />
                    </div>
                </div>
            </AppWindow>
        </div>
    );
}

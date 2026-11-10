'use client';

import { ArrowUp, Circle, CircleCheck, Hash, MessageCircleQuestionMark, Terminal } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CanvasNode } from '../../app/canvas.tsx';
import { AssistantText, PromptStack, WorkingRow } from '../../app/chat.tsx';
import { AppWindow, Dock, Rail, Sidebar, type SidebarRow, TopRow } from '../../app/chrome.tsx';
import { Button } from '../../app/primitives.tsx';
import { EASE, useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1800, 2000, 400, 4200] as const;
const CHOICES = ['Keep for 30 days', 'Clear on sign-out'] as const;

/*
 * The Needs you section of `sidebar/Sidebar.tsx`: a node row per waiting agent (`NodeRow` in `SidebarListRows.tsx`),
 * with the name of its view in faint text, oldest first. The two others wait in other views of the project.
 */
const OTHERS: readonly SidebarRow[] = [
    { id: 'release', name: 'Release', icon: 'claude', view: 'Ship', status: 'needs-you' },
    { id: 'docs', name: 'Claude Code', icon: Terminal, view: 'Docs', status: 'needs-you' }
];

/* What waits on you, in the sidebar's Needs you section and the dock's count, with a question of this canvas answered in its prompt stack. */
export function NeedsYou() {
    return (
        <Stage
            width={960}
            height={600}
            label="Three agents wait, listed under Needs you in the sidebar and counted in the dock. The question of the one on this canvas shows in the stack above the dock. You pick Keep for 30 days and click Answer; the agent works again and leaves the list."
        >
            <NeedsYouScene />
        </Stage>
    );
}

function NeedsYouScene() {
    const step = useTimeline(STEPS);
    const answered = step === 3;
    const carts: SidebarRow = { id: 'carts', name: 'Saved carts', icon: 'claude', view: 'Checkout', status: 'needs-you' };
    const waiting = answered ? OTHERS : [carts, ...OTHERS];

    return (
        <div className="absolute inset-0">
            <AppWindow
                sidebar={
                    <Sidebar
                        waiting={waiting}
                        rows={[
                            { id: 'checkout', name: 'Checkout', icon: Hash, selected: true },
                            { id: 'carts-node', name: 'Saved carts', icon: 'claude', nested: true, status: answered ? 'running' : 'needs-you' },
                            { id: 'ship', name: 'Ship', icon: Hash },
                            { id: 'docs-view', name: 'Docs', icon: Hash }
                        ]}
                    />
                }
                toolbar={<TopRow view={{ icon: Hash, name: 'Checkout' }} />}
                rail={<Rail />}
            >
                <div className="canvas-dots absolute inset-0 overflow-hidden">
                    <CanvasNode rect={{ x: 40, y: 28, w: 420, h: 150 }} kind="chat" agent title="Saved carts" status={answered ? 'running' : 'needs-you'}>
                        <div className="flex flex-col gap-3 px-4 py-3">
                            <AssistantText shown text="The cart now survives sign-in. How long should it stay?" />
                            {answered && <WorkingRow seconds={4} />}
                        </div>
                    </CanvasNode>
                    {/* `canvas/PromptStack.tsx`: the canvas's prompts above the dock, at most `max-w-xl` wide. */}
                    <AnimatePresence>
                        {!answered && (
                            <motion.div
                                className="absolute inset-x-0 bottom-16 flex justify-center px-6"
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                transition={{ duration: 0.4, ease: EASE }}
                            >
                                <div className="w-full max-w-[576px]">
                                    <PromptStack title="Saved carts" status="needs-you" meta="Claude Code · chat · 12:04">
                                        <QuestionCard picked={step >= 1} pressed={step === 2} />
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

/* `PromptCard.tsx` with `QuestionBody.tsx` and `QuestionActions`: the heading, a row per choice, the free answer, then Answer. */
function QuestionCard({ picked, pressed }: { readonly picked: boolean; readonly pressed: boolean }) {
    return (
        <div className="flex flex-col gap-2 p-3">
            <div className="flex items-start gap-2">
                <MessageCircleQuestionMark size={16} strokeWidth={1.75} className="mt-[3px] shrink-0 text-status-needs-you" />
                <h3 className="text-[14px] leading-[21px] font-semibold text-text">How long should a saved cart stay?</h3>
            </div>
            <div className="flex flex-col gap-2">
                {CHOICES.map((choice, i) => {
                    const selected = picked && i === 0;
                    const Mark = selected ? CircleCheck : Circle;

                    return (
                        <div
                            key={choice}
                            className={`flex min-h-9 items-start gap-2 rounded-lg border px-3 py-2 ${selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-hover'}`}
                        >
                            <Mark size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-text-muted" />
                            <span className="text-[14px] text-text">{choice}</span>
                        </div>
                    );
                })}
                <div className="flex min-h-9 items-start gap-2 rounded-lg border border-border bg-surface-hover px-3 py-2 text-[14px]">
                    <Circle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                    <span className="text-text-muted">Something else…</span>
                </div>
            </div>
            <div className="flex items-center gap-1.5">
                <span className="grow" />
                <Button variant="inverse" className={pressed ? 'scale-[0.96]' : ''}>
                    Answer <ArrowUp size={16} strokeWidth={1.75} />
                </Button>
            </div>
        </div>
    );
}

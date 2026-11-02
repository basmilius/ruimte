'use client';

import { MessageCircleQuestionMark } from 'lucide-react';
import { TerminalBody } from '../../app/bodies.tsx';
import { type AgentStatus, CanvasNode } from '../../app/canvas.tsx';
import { PromptStack } from '../../app/chat.tsx';
import { Dock } from '../../app/chrome.tsx';
import { Button, Reveal } from '../../app/primitives.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [3000, 3400, 3600] as const;
const STATUS: readonly AgentStatus[] = ['running', 'needs-you', 'idle'];

/* One agent in a terminal, in its own interface: it works, it asks in its own prompt, it is done. The header follows along. */
export function TerminalAgent() {
    return (
        <Stage
            width={720}
            height={500}
            label="Claude Code in a terminal node. The header reads Running while it works and Needs you while it asks permission in its own prompt, with a card that says to answer it in the terminal. Once it is done, the header reads Idle."
        >
            <TerminalScene />
        </Stage>
    );
}

function TerminalScene() {
    const step = useTimeline(STEPS);

    return (
        <div className="canvas-dots absolute inset-0 overflow-hidden rounded-xl border border-white/10">
            <CanvasNode rect={{ x: 40, y: 28, w: 640, h: 272 }} kind="terminal" agent title="Claude Code" status={STATUS[step]}>
                <TerminalBody>
                    <div>
                        <span className="text-ansi-magenta">&gt;</span> Fix the failing cart tests
                    </div>
                    <div> </div>
                    <div>
                        <span className="text-ansi-green">●</span> Read <span className="text-term-dim">src/cart.ts</span>
                    </div>
                    <div>
                        <span className="text-ansi-green">●</span> Update <span className="text-term-dim">src/cart.ts (+6 -2)</span>
                    </div>
                    <div> </div>
                    {step === 0 && <div className="text-ansi-yellow">✻ Working…</div>}
                    {step === 1 && (
                        <>
                            <div className="text-ansi-yellow">Run this command?</div>
                            <div>{'  '}bun test src/cart.test.ts</div>
                            <div> </div>
                            <div>
                                <span className="text-ansi-cyan">❯ 1. Yes</span>
                            </div>
                            <div>{'  '}2. No</div>
                        </>
                    )}
                    {step === 2 && (
                        <>
                            <div>
                                <span className="text-ansi-green">●</span> Both tests pass. The expiry compared dates in the wrong time zone.
                            </div>
                            <div> </div>
                            <div>
                                <span className="text-ansi-magenta">&gt;</span>{' '}
                                <span className="caret inline-block h-[13px] w-[7px] translate-y-[2px] bg-accent" />
                            </div>
                        </>
                    )}
                </TerminalBody>
            </CanvasNode>
            <Reveal shown={step === 1} className="absolute inset-x-0 bottom-16 flex justify-center px-6">
                <div className="w-full max-w-[460px]">
                    <PromptStack title="Claude Code" status="needs-you" meta="Claude Code · terminal · 12:05">
                        {/* `RuimtePromptView.tsx`, a waiting terminal: the request, then the way to the terminal. */}
                        <div className="flex flex-col gap-2 p-3">
                            <div className="flex items-start gap-2">
                                <MessageCircleQuestionMark size={16} strokeWidth={1.75} className="mt-[3px] shrink-0 text-status-needs-you" />
                                <h3 className="text-[14px] leading-[21px] font-semibold text-text">Approval requested by Bash</h3>
                            </div>
                            <pre className="font-mono text-[12px] text-text">bun test src/cart.test.ts</pre>
                            <p className="text-[14px] text-text-muted">Answer it in the terminal.</p>
                            <div className="flex justify-end">
                                <Button variant="inverse">Go to terminal</Button>
                            </div>
                        </div>
                    </PromptStack>
                </div>
            </Reveal>
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
                <Dock waiting={step === 1 ? 1 : 0} working={step === 0 ? 1 : 0} />
            </div>
        </div>
    );
}

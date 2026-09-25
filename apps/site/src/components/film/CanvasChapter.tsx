'use client';

import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { BrowserBody, TerminalBody } from '../app/bodies.tsx';
import { CanvasEdge, CanvasNode } from '../app/canvas.tsx';
import { ApprovalCard, AssistantText, Composer, PromptStack, ToolRow, UserBubble, WorkingRow } from '../app/chat.tsx';
import { Dock } from '../app/chrome.tsx';
import type { Rect } from '../app/edge-route.ts';
import { PersonCursor, Reveal, Typed } from '../app/primitives.tsx';
import { EASE } from './playback.ts';
import { chatStatus } from './script.ts';

const TERMINAL: Rect = { x: 36, y: 44, w: 318, h: 214 };
const NOTE: Rect = { x: 36, y: 318, w: 250, h: 132 };
const CHAT: Rect = { x: 404, y: 28, w: 340, h: 486 };
const BROWSER: Rect = { x: 790, y: 108, w: 212, h: 300 };

export function CanvasChapter({ step }: { readonly step: number }) {
    const status = chatStatus(step);
    const waiting = status === 'needs-you';

    return (
        <div className="canvas-dots absolute inset-0 overflow-hidden">
            <div className="absolute top-3 left-9 text-[18px] font-medium text-text">Signup</div>

            <CanvasEdge from={TERMINAL} to={CHAT} look="context" />
            <CanvasEdge from={NOTE} to={CHAT} look="context" />
            <CanvasEdge from={CHAT} to={BROWSER} look="context" shown={step >= 3} />

            <CanvasNode rect={TERMINAL} kind="terminal" title="dev server">
                <TerminalBody>
                    <div>
                        <span className="text-ansi-green">~/acme-web</span> <span className="text-term-dim">$</span> bun dev
                    </div>
                    <div> </div>
                    <div>
                        {'  '}
                        <span className="text-ansi-green">VITE</span> v7.1.4 <span className="text-term-dim">ready in</span> 312 ms
                    </div>
                    <div> </div>
                    <div>
                        {'  '}
                        <span className="text-ansi-green">➜</span> Local: <span className="text-ansi-cyan">http://localhost:5173/</span>
                    </div>
                    <Reveal shown={step >= 2} y={0}>
                        <span className="text-term-dim">12:04:31</span> <span className="text-ansi-cyan">[vite]</span> hmr update /src/SignupForm.tsx
                    </Reveal>
                </TerminalBody>
            </CanvasNode>

            <CanvasNode rect={NOTE} kind="note" title="Note">
                <div className="px-3 py-2.5 text-[14px] leading-normal text-text">A failed signup clears the email field. Ship the fix today.</div>
            </CanvasNode>

            <CanvasNode rect={CHAT} kind="chat" agent title="Fix signup" status={status}>
                <div className="flex h-full flex-col">
                    <div className="flex min-h-0 grow flex-col gap-3 overflow-hidden px-4 pt-4">
                        <UserBubble>Fix the bug in the note and check it in the browser.</UserBubble>
                        <AssistantText
                            shown={step >= 1}
                            text="The form resets its state before the request resolves, so a failed submit clears the email. I'll keep the values until the server answers."
                        />
                        {step >= 2 && (
                            <div>
                                <Reveal shown={step >= 2}>
                                    <ToolRow tool="read" label="Read" detail="src/SignupForm.tsx" />
                                </Reveal>
                                <Reveal shown={step >= 2} delay={0.4}>
                                    <ToolRow tool="edit" label="Edit" detail="src/SignupForm.tsx" live={step === 2} />
                                </Reveal>
                                <Reveal shown={step >= 6}>
                                    <ToolRow tool="bash" label="Ran" detail='git commit -m "fix: keep signup values"' />
                                </Reveal>
                            </div>
                        )}
                        <Reveal shown={step >= 6} delay={0.5} className="text-[14px] leading-[21px] text-text">
                            <Typed shown={step >= 6} words speed={22} text="Committed. The email now survives a failed submit." />
                        </Reveal>
                        {status === 'running' && step >= 1 && <WorkingRow seconds={step * 4 + 3} />}
                    </div>
                    <div className="px-3 pt-2 pb-3">
                        <Composer />
                    </div>
                </div>
            </CanvasNode>

            <CanvasNode rect={BROWSER} kind="browser" title="Sign up" shown={step >= 3}>
                <BrowserBody url="localhost:5173/signup" loading={step === 3}>
                    <SignupPage filled={step >= 3} />
                </BrowserBody>
            </CanvasNode>

            <AnimatePresence>
                {waiting && (
                    <motion.div
                        key="stack"
                        className="absolute inset-x-0 bottom-16 flex justify-center px-4"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.4, ease: EASE }}
                    >
                        <div className="w-full max-w-[540px]">
                            <PromptStack title="Fix signup" status="needs-you" meta="Claude · chat · 12:05">
                                <ApprovalCard cwd="~/acme-web" command='git commit -m "fix: keep signup values"' pressed={step === 5} />
                            </PromptStack>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="absolute inset-x-0 bottom-4 flex justify-center">
                <Dock waiting={waiting ? 1 : 0} working={status === 'running' ? 2 : 1} finished={step >= 6 ? 1 : 0} />
            </div>

            <PersonCursor x={step >= 5 ? 736 : 900} y={step >= 5 ? 646 : 700} click={step === 5} />
        </div>
    );
}

function SignupPage({ filled }: { readonly filled: boolean }) {
    return (
        <div className="absolute inset-0 space-y-2.5 bg-white p-4 text-[11px] text-[#18181b]">
            <div className="text-[16px] font-semibold">Create account</div>
            <div className="space-y-1">
                <div className="text-[#6f6f78]">Email</div>
                <div className="h-7 rounded-md border border-[#d4d4d8] px-2 leading-7">
                    <Typed shown={filled} text="ada@example.com" speed={45} />
                </div>
            </div>
            <div className="space-y-1">
                <div className="text-[#6f6f78]">Password</div>
                <div className="h-7 rounded-md border border-[#d4d4d8] px-2 leading-7 tracking-[0.2em]">{filled ? '••••••••' : ''}</div>
            </div>
            <div className="h-7 rounded-md bg-[#18181b] text-center leading-7 font-medium text-white">Sign up</div>
            <Reveal shown={filled} delay={1} className="flex items-center gap-1 text-[#16a34a]">
                <Check size={12} /> Email kept after an error
            </Reveal>
        </div>
    );
}

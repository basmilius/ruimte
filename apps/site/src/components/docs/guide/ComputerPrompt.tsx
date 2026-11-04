'use client';

import { CircleCheck, Hand } from 'lucide-react';
import { CanvasNode } from '../../app/canvas.tsx';
import { AssistantText, PromptStack, UserBubble } from '../../app/chat.tsx';
import { Dock } from '../../app/chrome.tsx';
import { Button } from '../../app/primitives.tsx';
import { Stage } from '../../film/Stage.tsx';

const CHAT = { x: 300, y: 20, w: 360, h: 190 };

/*
 * The card an agent's first reach for an app puts in the prompt stack (`prompts/RuimtePromptView.tsx`),
 * in the words of `prompts.computer.*`, with the buttons of `computerButtons`.
 */
export function ComputerPrompt() {
    return (
        <Stage
            width={960}
            height={500}
            label="A chat asks to use Mail. Above the dock, its card reads Let an agent use Mail?, says that the chat wants to see and operate Mail on this machine, and offers Deny, Always allow and Allow this time."
        >
            <div className="canvas-dots absolute inset-0 overflow-hidden rounded-xl border border-white/10">
                <CanvasNode rect={CHAT} kind="chat" agent title="Inbox triage" status="needs-you">
                    <div className="flex flex-col gap-3 px-4 pt-4">
                        <UserBubble>Flag the mails from customers about a lost cart.</UserBubble>
                        <AssistantText shown text="I need Mail open to read your inbox." />
                    </div>
                </CanvasNode>
                <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-3">
                    <div className="w-[560px]">
                        <PromptStack title="Inbox triage" status="needs-you" meta="Claude · chat · 10:12">
                            <div className="flex flex-col gap-2 p-3">
                                <div className="flex items-start gap-2">
                                    <Hand size={16} strokeWidth={1.75} className="mt-[3px] shrink-0 text-status-needs-you" />
                                    <h3 className="text-[14px] leading-[21px] font-semibold text-text">Let an agent use Mail?</h3>
                                </div>
                                <p className="text-sm text-text">Inbox triage in acme-web wants to see and operate Mail on this machine.</p>
                                <p className="font-mono text-xs text-text-muted">com.apple.mail</p>
                                <p className="text-xs text-text-muted">
                                    This time lasts until the agent's turn ends. Always lets every agent on this machine use Mail.
                                </p>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="ml-auto" />
                                    <Button>Deny</Button>
                                    <Button>Always allow</Button>
                                    <Button variant="inverse">
                                        <CircleCheck size={16} strokeWidth={1.75} /> Allow this time
                                    </Button>
                                </div>
                            </div>
                        </PromptStack>
                    </div>
                    <Dock waiting={1} />
                </div>
            </div>
        </Stage>
    );
}

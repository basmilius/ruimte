'use client';

import { ArrowUp, Circle, CircleCheck, MessageCircleQuestionMark } from 'lucide-react';
import { CanvasNode } from '../app/canvas.tsx';
import { AssistantText, PromptStack } from '../app/chat.tsx';
import { Button } from '../app/primitives.tsx';
import { useTimeline } from '../film/playback.ts';
import { Stage } from '../film/Stage.tsx';

const STEPS = [1600, 2200, 350, 4800] as const;
const CHOICES = [
    { label: 'Keep for 30 days', detail: 'Let customers pick up later.' },
    { label: 'Clear on sign-out', detail: 'Start with an empty cart.' },
    { label: 'Something else…', detail: '' }
] as const;

export function QuestionVignette() {
    return (
        <Stage
            width={640}
            height={460}
            label="The checkout agent asks how long to keep a saved cart. A question card shows two choices and a free-text answer. The person selects Keep for 30 days."
        >
            <QuestionScene />
        </Stage>
    );
}

// Matches prompts/ui/PromptCard, QuestionBody and QuestionActions in the client.
function QuestionScene() {
    const step = useTimeline(STEPS);
    return (
        <div className="absolute inset-0">
            <CanvasNode rect={{ x: 26, y: 20, w: 414, h: 126 }} kind="chat" agent title="Saved carts" status="needs-you">
                <div className="px-4 py-3">
                    <AssistantText shown text="The cart now survives sign-in. I need your decision on how long to keep it." />
                </div>
            </CanvasNode>
            <div className="absolute top-[172px] right-6 w-[510px]">
                <PromptStack title="Saved carts" status="needs-you" meta="Question">
                    <div className="flex flex-col gap-2 p-3">
                        <div className="flex items-start gap-2">
                            <MessageCircleQuestionMark size={16} strokeWidth={1.75} className="mt-[3px] shrink-0 text-status-needs-you" />
                            <h3 className="text-[14px] leading-[21px] font-semibold">How long should we keep a saved cart?</h3>
                        </div>
                        <div className="flex flex-col gap-2">
                            {CHOICES.map(({ label, detail }, i) => {
                                const selected = step >= 1 && i === 0;
                                const Mark = selected ? CircleCheck : Circle;
                                return (
                                    <div
                                        key={label}
                                        className={`flex min-h-9 items-start gap-2 rounded-lg border px-3 py-2 ${selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-hover'}`}
                                    >
                                        <Mark size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-text-muted" />
                                        <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-[19px]">
                                            <span>{label}</span>
                                            <span className="text-text-muted">{detail}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex justify-end pt-1">
                            <Button variant="inverse" className={step === 2 ? 'scale-[0.96]' : ''}>
                                Answer <ArrowUp size={16} strokeWidth={1.75} />
                            </Button>
                        </div>
                    </div>
                </PromptStack>
            </div>
        </div>
    );
}

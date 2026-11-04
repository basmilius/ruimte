'use client';

import { Check, Hash, MicOff, StickyNote } from 'lucide-react';
import { CanvasNode } from '../../app/canvas.tsx';
import { Button } from '../../app/primitives.tsx';
import { Stage } from '../../film/Stage.tsx';
import { GuideWindow, SidePanel } from './parts.tsx';

const NOTE = { x: 60, y: 60, w: 240, h: 132 };

/* A still of both voices: the person above the line, Voice Control below it, as `VoiceWaveform.tsx` splits them. */
const BANDS = [3, 6, 10, 14, 9, 5, 12, 18, 22, 16, 11, 7, 4, 3, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
const ANSWER = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 6, 11, 17, 21, 15, 19, 24, 18, 12, 16, 10, 7, 5, 3, 2];

const TRANSCRIPT = [
    { speaker: 'You', at: '0:04', text: 'Add a note on Checkout: a saved cart stays for 30 days.' },
    { speaker: 'Voice Control', at: '0:07', text: 'Done. The note is on the Checkout canvas.' }
] as const;

/*
 * The Voice Control panel (`voice/VoicePanelBody.tsx`): the status in the header, the waveform, the
 * transcript with an action between the turns, and the button that ends the conversation.
 */
export function VoiceControl() {
    return (
        <Stage
            width={1040}
            height={540}
            label="The Voice Control panel, live for 12 seconds. You asked for a note about saved carts, Voice Control added it to the Checkout canvas and says so. The note shows on the canvas, and at the bottom of the panel is End conversation."
        >
            <GuideWindow
                view={{ icon: Hash, name: 'Checkout' }}
                selected="checkout"
                sidePanel={
                    <SidePanel
                        title="Voice Control"
                        width={340}
                        actions={
                            <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
                                <span className="size-1.5 rounded-full bg-positive" />
                                <span className="tabular-nums">Live · 0:12</span>
                            </span>
                        }
                    >
                        <section className="relative shrink-0 px-4 pt-4 pb-5">
                            <div className="flex items-center justify-between text-xs font-medium tabular-nums">
                                <span className="text-text-muted">You · listening</span>
                                <span className="text-accent">Voice Control · speaking</span>
                            </div>
                            <div className="relative mt-3 flex h-14 items-center gap-0.5">
                                <span className="absolute inset-x-0 top-1/2 z-10 h-px bg-surface" />
                                {BANDS.map((input, index) => (
                                    <span key={index} className="relative h-full min-w-0 grow">
                                        <span className="absolute inset-x-0 bottom-1/2 rounded-t-sm bg-accent/60" style={{ height: input }} />
                                        <span className="absolute inset-x-0 top-1/2 rounded-b-sm bg-accent" style={{ height: ANSWER[index] }} />
                                    </span>
                                ))}
                            </div>
                        </section>
                        <div className="min-h-0 grow overflow-hidden px-4 py-5">
                            <Utterance {...TRANSCRIPT[0]} />
                            <div className="mt-6 flex min-h-11 items-center gap-2.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5">
                                <StickyNote size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" />
                                <p className="min-w-0 grow truncate text-xs text-text">
                                    <span className="font-medium">Added note</span>
                                    <span className="text-text-muted"> · Checkout</span>
                                </p>
                                <span className="grid size-8 shrink-0 place-items-center">
                                    <Check size={14} strokeWidth={1.75} className="text-positive" />
                                </span>
                            </div>
                            <div className="mt-6">
                                <Utterance {...TRANSCRIPT[1]} />
                            </div>
                        </div>
                        <footer className="shrink-0 border-t border-border p-3">
                            <Button variant="secondary" size="md" className="w-full">
                                <MicOff size={14} strokeWidth={1.75} /> End conversation
                            </Button>
                        </footer>
                    </SidePanel>
                }
            >
                <div className="canvas-dots absolute inset-0">
                    <CanvasNode rect={NOTE} kind="note" title="Saved carts">
                        <div className="px-3 py-2.5 text-[14px] leading-[21px] text-text">A saved cart stays for 30 days.</div>
                    </CanvasNode>
                </div>
            </GuideWindow>
        </Stage>
    );
}

function Utterance({ speaker, at, text }: { readonly speaker: string; readonly at: string; readonly text: string }) {
    return (
        <div>
            <div className={`mb-1.5 text-xs font-medium tabular-nums ${speaker === 'Voice Control' ? 'text-accent' : 'text-text-muted'}`}>
                {speaker} · {at}
            </div>
            <p className="text-sm leading-6 text-text">{text}</p>
        </div>
    );
}

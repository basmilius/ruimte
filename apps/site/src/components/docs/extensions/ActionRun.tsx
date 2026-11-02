'use client';

import { Sparkles } from 'lucide-react';
import { CanvasEdge, CanvasNode } from '../../app/canvas.tsx';
import { TerminalBody } from '../../app/bodies.tsx';
import { FLOAT, WindowBar } from '../../app/chrome.tsx';
import { Button, Separator } from '../../app/primitives.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';
import { Spinner } from './slot-parts.tsx';

const STEPS = [1600, 2400, 3600] as const;
const NOTE = { x: 32, y: 32, w: 248, h: 150 };
const TERMINAL = { x: 312, y: 32, w: 264, h: 150 };
const SUMMARY = { x: 172, y: 236, w: 264, h: 132 };

/* Summarize runs on two nodes: both show a spinner, then the summary arrives as a linked note. */
export function ActionRun() {
    return (
        <Stage width={760} height={460} label="Two selected nodes. Summarize runs, both show a spinner, and a linked note with the summary appears.">
            <ActionRunScene />
        </Stage>
    );
}

function ActionRunScene() {
    const step = useTimeline(STEPS);
    const running = step === 1;
    const done = step === 2;

    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-surface shadow-[0_24px_60px_rgb(0_0_0/0.45)]">
            <WindowBar />
            <div className="canvas-dots relative grow">
                <CanvasEdge from={NOTE} to={SUMMARY} shown={done} />
                <CanvasEdge from={TERMINAL} to={SUMMARY} shown={done} delay={0.15} />
                <CanvasNode rect={NOTE} kind="note" title="Brief" selected={!done}>
                    <div className="px-3 py-2.5 text-[14px] leading-[21px]">
                        <p className="font-semibold">Signup keeps the email.</p>
                        <p className="mt-2 text-text-muted">A failed submit must not clear the form.</p>
                    </div>
                </CanvasNode>
                <CanvasNode rect={TERMINAL} kind="terminal" title="tests" selected={!done}>
                    <TerminalBody>
                        <div className="text-term-dim">$ bun test signup</div>
                        <div className="mt-2 text-ansi-red">✗ keeps the email</div>
                    </TerminalBody>
                </CanvasNode>
                {running && (
                    <>
                        <Spinner className="absolute z-10" style={{ left: NOTE.x + NOTE.w - 84, top: NOTE.y + 13 }} />
                        <Spinner className="absolute z-10" style={{ left: TERMINAL.x + TERMINAL.w - 84, top: TERMINAL.y + 13 }} />
                    </>
                )}
                <CanvasNode rect={SUMMARY} kind="note" title="Summary" shown={done}>
                    <div className="px-3 py-2.5 text-[14px] leading-[21px]">
                        <p>The test fails because a failed submit resets the form. The brief asks to keep the email.</p>
                    </div>
                </CanvasNode>
                {!done && (
                    <div className={`absolute bottom-5 left-1/2 flex h-10 -translate-x-1/2 items-center gap-1 rounded-xl px-1 text-[13px] ${FLOAT}`}>
                        <span className="px-2 text-text-muted">2 selected</span>
                        <Separator />
                        <Button size="sm" className={running ? 'text-text-faint' : 'text-text'}>
                            {running ? <Spinner /> : <Sparkles size={14} strokeWidth={1.75} className="text-accent" />}
                            Summarize
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

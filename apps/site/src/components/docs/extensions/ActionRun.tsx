'use client';

import { Sparkles } from 'lucide-react';
import { Spinner } from '@adecore/ui';
import { CanvasEdge, CanvasNode } from '../../app/canvas.tsx';
import { TerminalBody } from '../../app/bodies.tsx';
import { WindowBar } from '../../app/chrome.tsx';
import { Button } from '../../app/primitives.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';
import { NoteText, SceneFrame, SelectionBar } from './parts.tsx';

const STEPS = [1600, 2400, 3600] as const;
const NOTE = { x: 48, y: 72, w: 260, h: 140 };
const TERMINAL = { x: 452, y: 72, w: 260, h: 140 };
const SUMMARY = { x: 250, y: 262, w: 260, h: 130 };

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
    const sign = running && <Spinner size={14} />;

    return (
        <SceneFrame>
            <WindowBar />
            <div className="canvas-dots relative grow">
                <CanvasEdge from={NOTE} to={SUMMARY} shown={done} />
                <CanvasEdge from={TERMINAL} to={SUMMARY} shown={done} delay={0.15} />
                <CanvasNode rect={NOTE} kind="note" title="Brief" selected={!done} actions={sign}>
                    <NoteText>
                        <p className="font-semibold">Signup keeps the email.</p>
                        <p className="mt-2 text-text-muted">A failed submit must not clear the form.</p>
                    </NoteText>
                </CanvasNode>
                <CanvasNode rect={TERMINAL} kind="terminal" title="tests" selected={!done} actions={sign}>
                    <TerminalBody>
                        <div className="text-term-dim">$ bun test signup</div>
                        <div className="mt-2 text-ansi-red">✗ keeps the email</div>
                    </TerminalBody>
                </CanvasNode>
                <CanvasNode rect={SUMMARY} kind="note" title="Summary" shown={done}>
                    <NoteText>
                        <p>The test fails because a failed submit resets the form. The brief asks to keep the email.</p>
                    </NoteText>
                </CanvasNode>
                {!done && (
                    <SelectionBar>
                        <Button className={running ? 'opacity-50' : ''}>
                            {running ? <Spinner size={14} /> : <Sparkles size={14} strokeWidth={1.75} />}
                            Summarize
                        </Button>
                    </SelectionBar>
                )}
            </div>
        </SceneFrame>
    );
}

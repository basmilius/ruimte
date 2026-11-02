import type { CSSProperties } from 'react';
import { MockFigure, MockLine, MockNode, MockWindow } from './primitives';

/* An action at work: the nodes it is about show a spinner, and its button waits until it is done. */
export function ActionRun() {
    return (
        <MockFigure caption="While Summarize runs, both nodes it is about show a spinner that also stops it, and the button waits.">
            <MockWindow>
                <div className="relative h-56 overflow-hidden bg-bg">
                    <div className="mock-grid absolute inset-0" />
                    <MockNode title="design.md" accent className="absolute top-6 left-6 h-28 w-40">
                        <MockLine width="75%" />
                        <MockLine width="60%" tone="faint" />
                        <span className="mock-spinner absolute top-1.5 right-2" />
                    </MockNode>
                    <MockNode title="codex" accent className="absolute top-6 left-52 h-28 w-40">
                        <MockLine width="80%" />
                        <MockLine width="50%" tone="faint" />
                        <span className="mock-spinner absolute top-1.5 right-2" />
                    </MockNode>
                    <MockNode
                        title="Summary"
                        className="mock-appear absolute top-12 left-100 hidden h-24 w-36 md:flex"
                        style={{ '--delay': '1s' } as CSSProperties}
                    >
                        <MockLine width="70%" tone="accent" />
                        <MockLine width="85%" tone="faint" />
                    </MockNode>
                    <div className="absolute bottom-5 left-6 flex h-8 items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3">
                        <span className="text-2xs text-text-muted">2 selected</span>
                        <span className="flex items-center gap-1.5 rounded bg-accent/15 px-1.5 text-2xs text-text-muted">
                            <span className="mock-spinner" />
                            Summarize
                        </span>
                    </div>
                </div>
            </MockWindow>
        </MockFigure>
    );
}

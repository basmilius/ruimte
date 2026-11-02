import type { CSSProperties } from 'react';
import { MockFigure, MockLine, MockWindow } from './primitives';

const BARS = [38, 62, 48, 80, 66];

/* A thread where a `chart` fence draws as a chart, and the composer offers a slash command of an extension. */
export function ChatBlocks() {
    return (
        <MockFigure caption="An agent wrote a chart fence, which the extension draws. Below, /review comes from the same extension.">
            <MockWindow>
                <div className="flex h-80 flex-col bg-surface">
                    <div className="flex grow flex-col gap-3 overflow-hidden p-4">
                        <div className="ml-auto flex w-2/3 flex-col gap-1.5 rounded-lg bg-surface-raised p-2.5">
                            <MockLine width="85%" />
                            <MockLine width="40%" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <MockLine width="70%" tone="faint" />
                            <MockLine width="55%" tone="faint" />
                        </div>
                        <div className="flex h-28 w-72 max-w-full items-end gap-3 rounded-lg border border-accent/50 bg-bg p-3">
                            {BARS.map((height, index) => (
                                <span
                                    key={height}
                                    className="mock-bar w-6 rounded-t bg-accent/70"
                                    style={{ height: `${height}%`, '--delay': `${index * 0.15}s` } as CSSProperties}
                                />
                            ))}
                        </div>
                    </div>
                    <div className="relative m-3 flex h-10 items-center rounded-lg border border-border-strong bg-surface-raised px-3 font-mono text-xs text-text">
                        /rev
                        <span className="mock-caret ml-px h-4 w-px bg-text" />
                        <div className="absolute bottom-11 left-0 flex w-64 flex-col gap-0.5 rounded-lg border border-border-strong bg-surface-raised p-1 font-sans">
                            <span className="flex items-baseline gap-2 rounded bg-accent/15 px-2 py-1">
                                <span className="text-xs text-text">/review</span>
                                <span className="truncate text-2xs text-text-muted">Ask for a review of the open diff</span>
                            </span>
                        </div>
                    </div>
                </div>
            </MockWindow>
        </MockFigure>
    );
}

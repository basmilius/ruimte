import type { CSSProperties } from 'react';
import { MockFigure, MockLine, MockNode, MockWindow } from './primitives';

const delay = (seconds: number) => ({ '--delay': `${seconds}s` }) as CSSProperties;

/* The surfaces an extension draws itself, as they arrive in a window: a node, a panel, a sidebar card and an overlay. */
export function Surfaces() {
    return (
        <MockFigure caption="An extension's node on the canvas, its panel on the right, its card in the sidebar and an overlay over everything.">
            <MockWindow>
                <div className="relative flex h-80">
                    <aside className="flex w-36 shrink-0 flex-col gap-2 border-r border-border bg-surface p-3">
                        <MockLine width="70%" />
                        <MockLine width="55%" tone="faint" />
                        <div className="mock-appear mt-auto flex flex-col gap-1.5 rounded-md border border-accent/50 bg-surface-raised p-2" style={delay(1.2)}>
                            <span className="text-2xs text-text-muted">Today</span>
                            <MockLine width="80%" tone="accent" />
                            <MockLine width="60%" tone="faint" />
                        </div>
                    </aside>
                    <div className="relative grow overflow-hidden bg-bg">
                        <div className="mock-grid absolute inset-0" />
                        <MockNode title="claude" className="absolute top-8 left-6 h-28 w-36">
                            <MockLine width="80%" />
                            <MockLine width="60%" tone="faint" />
                        </MockNode>
                        <MockNode title="Counter" accent className="mock-appear absolute top-8 left-48 h-28 w-36" style={delay(0.2)}>
                            <span className="mx-auto mt-3 text-lg font-semibold text-text">42</span>
                        </MockNode>
                    </div>
                    <aside className="mock-appear hidden w-40 shrink-0 flex-col border-l border-accent/50 bg-surface sm:flex" style={delay(0.7)}>
                        <div className="flex h-8 items-center border-b border-border px-3 text-2xs text-text-muted">Review</div>
                        <div className="flex flex-col gap-2 p-3">
                            <MockLine width="85%" tone="accent" />
                            <MockLine width="60%" tone="faint" />
                            <MockLine width="70%" tone="faint" />
                        </div>
                    </aside>
                    <div
                        className="mock-appear absolute top-48 right-48 flex w-56 flex-col overflow-hidden rounded-lg border border-border-strong bg-surface-raised shadow-xl"
                        style={delay(1.8)}
                    >
                        <div className="flex h-8 items-center justify-between border-b border-border px-3 text-2xs text-text">
                            Rename
                            <span className="text-text-faint">×</span>
                        </div>
                        <div className="flex flex-col gap-2 p-3">
                            <span className="h-6 rounded border border-border bg-surface-sunken" />
                            <span className="ml-auto h-5 w-14 rounded bg-accent/70" />
                        </div>
                    </div>
                </div>
            </MockWindow>
        </MockFigure>
    );
}

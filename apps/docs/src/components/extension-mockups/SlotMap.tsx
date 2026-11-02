import type { CSSProperties, ReactNode } from 'react';
import { MockFigure, MockLine, MockNode, MockWindow, SlotLabel } from './primitives';

/* A spot that lights up in its turn, with the name of the slot on it. */
function Slot({
    name,
    order,
    className = '',
    children
}: {
    readonly name: string;
    readonly order: number;
    readonly className?: string;
    readonly children?: ReactNode;
}) {
    return (
        <div className={`mock-slot rounded-md ${className}`} style={{ '--order': order } as CSSProperties}>
            {children}
            <SlotLabel name={name} className="absolute -top-2 left-1.5" />
        </div>
    );
}

/* Where an extension can add to Ruimte: a window in miniature with a handful of its slots marked. */
export function SlotMap() {
    return (
        <MockFigure caption="A few of the slots: the sidebar's footer, a node's header, the selection bar, the canvas menu and a panel's header.">
            <MockWindow>
                <div className="flex h-96">
                    <aside className="flex w-36 shrink-0 flex-col gap-2 border-r border-border bg-surface p-3">
                        <MockLine width="70%" />
                        <MockLine width="55%" tone="faint" />
                        <MockLine width="62%" tone="faint" />
                        <MockLine width="48%" tone="faint" />
                        <Slot name="sidebarFooter" order={0} className="relative mt-auto flex h-8 items-center gap-1.5 px-2">
                            <span className="size-3 rounded bg-accent/60" />
                            <MockLine width="50%" />
                        </Slot>
                    </aside>
                    <div className="relative grow overflow-hidden bg-bg">
                        <div className="mock-grid absolute inset-0" />
                        <MockNode title="claude" className="absolute top-8 left-6 h-28 w-40">
                            <MockLine width="80%" />
                            <MockLine width="60%" tone="faint" />
                            <MockLine width="70%" tone="faint" />
                        </MockNode>
                        <Slot name="nodeHeader" order={1} className="absolute top-8 left-52 w-44">
                            <MockNode title="notes" className="h-28">
                                <MockLine width="65%" />
                                <MockLine width="75%" tone="faint" />
                            </MockNode>
                        </Slot>
                        <Slot name="selectionBar" order={2} className="absolute right-6 bottom-6 flex h-8 items-center gap-2 bg-surface-raised px-3">
                            <span className="text-2xs text-text-muted">2 selected</span>
                            <span className="rounded bg-accent/20 px-1.5 text-2xs text-text">Summarize</span>
                        </Slot>
                        <Slot name="canvasMenu" order={3} className="absolute top-48 left-8 flex w-36 flex-col gap-1.5 bg-surface-raised p-2">
                            <MockLine width="70%" tone="faint" />
                            <MockLine width="55%" tone="faint" />
                            <span className="h-px bg-border" />
                            <MockLine width="60%" tone="accent" />
                        </Slot>
                    </div>
                    <aside className="hidden w-40 shrink-0 flex-col border-l border-border bg-surface sm:flex">
                        <Slot name="panelHeader" order={4} className="relative m-2 flex h-7 items-center gap-1.5 px-2">
                            <MockLine width="45%" />
                        </Slot>
                        <div className="flex flex-col gap-2 p-3">
                            <MockLine width="80%" tone="faint" />
                            <MockLine width="60%" tone="faint" />
                            <MockLine width="70%" tone="faint" />
                        </div>
                    </aside>
                </div>
            </MockWindow>
        </MockFigure>
    );
}

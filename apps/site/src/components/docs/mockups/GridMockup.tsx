import type { ReactNode } from 'react';
import clsx from 'clsx';
import { MockStage } from './MockStage';
import { KindMark, type MockKind, MockWindow, SidebarLabel, SidebarRow, StatusDot } from './parts';

function Cell({
    tabs,
    focused = false,
    children
}: {
    readonly tabs: readonly { readonly kind: MockKind; readonly title: string }[];
    readonly focused?: boolean;
    readonly children: ReactNode;
}) {
    return (
        <div className={clsx('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-surface', focused ? 'border-border-strong' : 'border-border')}>
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-1.5">
                {tabs.map((tab, index) => (
                    <span
                        key={tab.title}
                        className={clsx(
                            'flex h-6 items-center gap-1.5 rounded-md px-2 text-2xs',
                            index === 0 ? 'bg-surface-active text-text' : 'text-text-muted'
                        )}
                    >
                        <KindMark kind={tab.kind} />
                        {tab.title}
                    </span>
                ))}
            </div>
            <div className="relative min-h-0 grow">{children}</div>
        </div>
    );
}

/* Four views at once: a split grid of cells, one of them holding two tabs. */
export function GridMockup() {
    return (
        <MockStage width={720} height={400} caption="Four views side by side in a grid. The top right cell holds two tabs, the dev server and the tests.">
            <MockWindow project="shop">
                <div className="flex w-40 shrink-0 flex-col border-r border-border px-2 py-2">
                    <SidebarLabel>Views</SidebarLabel>
                    <SidebarRow kind="canvas" title="Checkout" active />
                    <SidebarRow kind="terminal" title="dev server" status="running" pulse={false} />
                    <SidebarRow kind="terminal" title="tests" status="idle" />
                    <SidebarRow kind="chat" title="Saved carts" status="needs-you" pulse />
                    <SidebarRow kind="file" title="cart.ts" />
                </div>
                <div className="grid min-w-0 grow grid-cols-2 grid-rows-2 gap-1.5 p-1.5">
                    <Cell tabs={[{ kind: 'canvas', title: 'Checkout' }]}>
                        <div className="mock-grid absolute inset-0">
                            <div className="absolute top-4 left-4 h-16 w-24 rounded-lg border border-border bg-surface-raised" />
                            <div className="absolute top-8 left-36 h-20 w-28 rounded-lg border border-border bg-surface-raised" />
                        </div>
                    </Cell>
                    <Cell
                        tabs={[
                            { kind: 'terminal', title: 'dev server' },
                            { kind: 'terminal', title: 'tests' }
                        ]}
                    >
                        <div className="space-y-0.5 p-3 font-mono text-2xs text-text-muted">
                            <div className="text-text">$ bun dev</div>
                            <div>ready on localhost:5173</div>
                        </div>
                    </Cell>
                    <Cell tabs={[{ kind: 'chat', title: 'Saved carts' }]} focused>
                        <div className="space-y-2 p-3 text-2xs text-text-muted">
                            <div>The tests pass. May I push the branch?</div>
                            <div className="flex items-center gap-1.5 text-status-needs-you">
                                <StatusDot status="needs-you" pulse />
                                Permission request
                            </div>
                        </div>
                    </Cell>
                    <Cell tabs={[{ kind: 'file', title: 'cart.ts' }]}>
                        <div className="space-y-1 p-3 font-mono text-2xs text-text-muted">
                            <div>
                                <span className="text-accent">export function</span> restoreCart(user) {'{'}
                            </div>
                            <div className="pl-4">return carts.find(user.id);</div>
                            <div>{'}'}</div>
                        </div>
                    </Cell>
                </div>
            </MockWindow>
        </MockStage>
    );
}

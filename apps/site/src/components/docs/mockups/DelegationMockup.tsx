import { MockStage } from './MockStage';
import { MockLine, MockLines, MockNode } from './parts';

function LineLabel({ x, y, children, tone }: { readonly x: number; readonly y: number; readonly children: string; readonly tone: 'open' | 'done' }) {
    return (
        <span
            className={`absolute -translate-1/2 rounded-full border border-border bg-surface px-2 py-0.5 text-2xs ${tone === 'done' ? 'text-status-idle' : 'text-text-muted'}`}
            style={{ left: x, top: y }}
        >
            {children}
        </span>
    );
}

/* An agent that handed two tasks to agents it opened: one is done, the other still works in its own worktree. */
export function DelegationMockup() {
    return (
        <MockStage
            width={720}
            height={340}
            caption="A chat that opened two agents and gave each a task. A line runs from the parent into each child, dashed while its task is open. One task is done; the other agent still works, in a worktree of its own."
        >
            <div className="mock-grid relative size-full">
                <MockLines width={720} height={340}>
                    <MockLine d="M 262 170 C 360 170, 350 92, 442 92" look="context" />
                    <MockLine d="M 262 170 C 360 170, 350 252, 442 252" look="task" />
                </MockLines>
                <LineLabel x={354} y={122} tone="done">
                    done
                </LineLabel>
                <LineLabel x={354} y={222} tone="open">
                    task
                </LineLabel>
                <MockNode x={30} y={84} w={230} h={172} kind="chat" title="Slow checkout" status="delegating">
                    <div className="space-y-2 p-3 text-2xs text-text-muted">
                        <div className="ml-auto w-fit rounded-lg bg-surface-raised px-2.5 py-1.5 text-text">Why is checkout slow?</div>
                        <div>Gave request tracing and query analysis to two agents. I will combine their results.</div>
                    </div>
                </MockNode>
                <MockNode x={450} y={30} w={240} h={124} kind="chat" title="Query analysis" status="idle" className="mock-appear">
                    <div className="space-y-1 p-3 text-2xs text-text-muted">
                        <div>The cart query reads every line item twice. An index on cart_id fixes it.</div>
                    </div>
                </MockNode>
                <MockNode
                    x={450}
                    y={190}
                    w={240}
                    h={124}
                    kind="chat"
                    title="Request tracing"
                    status="running"
                    className="mock-appear"
                    style={{ animationDelay: '0.3s' }}
                >
                    <div className="space-y-2 p-3 text-2xs text-text-muted">
                        <div>Tracing POST /checkout with timing per step.</div>
                        <span className="inline-block rounded-md bg-text/7 px-2 py-0.5 font-mono">trace-checkout</span>
                    </div>
                </MockNode>
            </div>
        </MockStage>
    );
}

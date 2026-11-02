import type { ReactNode } from 'react';
import { MockStage } from './MockStage';
import { MockNode, StatusPill } from './parts';

/* Three moments of one agent, in turn: it works, it asks in its own prompt, it is done. */
function Cycle({ children }: { readonly children: ReactNode }) {
    return <span className="grid *:col-start-1 *:row-start-1">{children}</span>;
}

export function TerminalMockup() {
    return (
        <MockStage
            width={640}
            height={300}
            caption="An agent in a terminal. Its status in the header follows the CLI: Running while it works, Needs you while it asks a question in its own prompt, and Idle once it is done."
        >
            <div className="mock-grid relative size-full">
                <MockNode
                    x={40}
                    y={30}
                    w={560}
                    h={240}
                    kind="terminal"
                    title="Claude Code"
                    badge={
                        <Cycle>
                            <span className="mock-cycle">
                                <StatusPill status="running" />
                            </span>
                            <span className="mock-cycle">
                                <StatusPill status="needs-you" pulse />
                            </span>
                            <span className="mock-cycle">
                                <StatusPill status="idle" />
                            </span>
                        </Cycle>
                    }
                >
                    <div className="grid h-full p-4 font-mono text-xs leading-relaxed text-text-muted *:col-start-1 *:row-start-1">
                        <div className="mock-cycle">
                            <div className="text-text">&gt; Fix the failing cart tests</div>
                            <div className="mt-2">Read src/cart.ts</div>
                            <div>Edited src/cart.ts (+6 -2)</div>
                            <div className="mt-2 text-status-running">Working…</div>
                        </div>
                        <div className="mock-cycle">
                            <div className="text-text">&gt; Fix the failing cart tests</div>
                            <div className="mt-2">Edited src/cart.ts (+6 -2)</div>
                            <div className="mt-3 rounded-md border border-status-needs-you/50 px-3 py-2">
                                <div className="text-text">Run this command?</div>
                                <div>bun test src/cart.test.ts</div>
                                <div className="mt-1 text-text">1. Yes 2. No</div>
                            </div>
                        </div>
                        <div className="mock-cycle">
                            <div className="text-text">&gt; Fix the failing cart tests</div>
                            <div className="mt-2">Both tests pass. The expiry compared dates in the wrong time zone.</div>
                            <div className="mt-3 text-text">
                                &gt; <span className="mock-caret">▍</span>
                            </div>
                        </div>
                    </div>
                </MockNode>
            </div>
        </MockStage>
    );
}

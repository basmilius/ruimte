import { MockStage } from './MockStage';
import { MockLine, MockLines, MockNode } from './parts';

/* Nodes arrive one by one, then the lines that give the agent its context draw themselves in. */
export function CanvasMockup() {
    return (
        <MockStage
            width={720}
            height={360}
            caption="A canvas. A group holds a note and a terminal, each with a context line into the chat, so the agent can read both. A target line runs from the chat to the browser it drives."
        >
            <div className="mock-grid relative size-full">
                <MockLines width={720} height={360}>
                    <MockLine d="M 202 104 C 236 104, 232 110, 266 110" look="context" draw={{ delay: 1.2, end: [266, 110] }} />
                    <MockLine d="M 202 265 C 236 265, 232 200, 266 200" look="context" draw={{ delay: 1.8, end: [266, 200] }} />
                    <MockLine d="M 500 155 L 532 155" look="target" />
                </MockLines>
                <MockNode x={16} y={14} w={202} h={332} kind="group" title="Context" className="mock-appear" />
                <MockNode x={32} y={44} w={170} h={120} kind="note" title="Brief" className="mock-appear" style={{ animationDelay: '0.1s' }}>
                    <div className="space-y-1 p-3 text-2xs text-text-muted">
                        <div className="font-medium text-text">Saved carts</div>
                        <div>Keep a cart for 30 days.</div>
                    </div>
                </MockNode>
                <MockNode x={32} y={200} w={170} h={130} kind="terminal" title="tests" status="idle" className="mock-appear" style={{ animationDelay: '0.3s' }}>
                    <div className="space-y-0.5 p-3 font-mono text-2xs text-text-muted">
                        <div className="text-text">$ bun test</div>
                        <div>48 pass</div>
                        <div className="text-status-error">2 fail</div>
                    </div>
                </MockNode>
                <MockNode
                    x={270}
                    y={44}
                    w={230}
                    h={230}
                    kind="chat"
                    title="Checkout agent"
                    status="running"
                    selected
                    className="mock-appear"
                    style={{ animationDelay: '0.5s' }}
                >
                    <div className="space-y-2 p-3 text-2xs">
                        <div className="ml-auto w-fit rounded-lg bg-surface-raised px-2.5 py-1.5 text-text">Fix the two failing tests.</div>
                        <div className="text-text-muted">Both fail on an expired cart. Reading the test output from the terminal.</div>
                    </div>
                </MockNode>
                <MockNode x={536} y={80} w={168} h={150} kind="browser" title="localhost:5173" className="mock-appear" style={{ animationDelay: '0.7s' }}>
                    <div className="space-y-2 p-3">
                        <div className="h-2 w-20 rounded-full bg-text/15" />
                        <div className="h-2 w-28 rounded-full bg-text/10" />
                        <div className="h-2 w-24 rounded-full bg-text/10" />
                        <div className="h-5 w-16 rounded-md bg-accent/40" />
                    </div>
                </MockNode>
            </div>
        </MockStage>
    );
}

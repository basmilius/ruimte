import { MockStage } from './MockStage';
import { MockLine, MockLines, MockNode, MockWindow, SidebarLabel, SidebarRow, StatusDot } from './parts';

/* The whole window: a project's sidebar of views beside a canvas with a brief, an agent and its page. */
export function WorkspaceMockup() {
    return (
        <MockStage
            width={720}
            height={420}
            caption="A project in Ruimte. The sidebar lists its views and what needs you; the open view is a canvas with a note, a chat and a browser, joined by lines."
        >
            <MockWindow project="shop">
                <div className="flex w-48 shrink-0 flex-col border-r border-border px-2 py-2">
                    <SidebarLabel>Views</SidebarLabel>
                    <SidebarRow kind="canvas" title="Checkout" active />
                    <SidebarRow kind="chat" title="Review #42" status="needs-you" pulse />
                    <SidebarRow kind="terminal" title="dev server" status="running" pulse={false} />
                    <SidebarRow kind="note" title="Release notes" />
                    <SidebarLabel>Needs you</SidebarLabel>
                    <div className="rounded-lg border border-border bg-surface px-2.5 py-2">
                        <div className="flex items-center gap-1.5 text-2xs font-medium text-text">
                            <StatusDot status="needs-you" />
                            Review #42
                        </div>
                        <div className="mt-1 truncate text-2xs text-text-muted">Wants to run: git push</div>
                    </div>
                </div>
                <div className="mock-grid relative grow">
                    <MockLines width={528} height={380}>
                        <MockLine d="M 178 90 C 210 90, 214 80, 246 80" look="context" />
                        <MockLine d="M 360 238 L 360 262" look="target" />
                    </MockLines>
                    <MockNode x={20} y={30} w={156} h={150} kind="note" title="Brief">
                        <div className="space-y-1.5 p-3 text-2xs text-text-muted">
                            <div className="font-medium text-text">Saved carts</div>
                            <div>Keep a cart for 30 days.</div>
                            <div>Show it after sign-in.</div>
                        </div>
                    </MockNode>
                    <MockNode x={250} y={30} w={250} h={206} kind="chat" title="Checkout agent" status="running">
                        <div className="space-y-2 p-3 text-2xs">
                            <div className="ml-auto w-fit rounded-lg bg-surface-raised px-2.5 py-1.5 text-text">Build saved carts from the brief.</div>
                            <div className="text-text-muted">Read the brief. Adding a carts table and a restore step after sign-in.</div>
                            <div className="text-text-faint">Edited 3 files</div>
                        </div>
                    </MockNode>
                    <MockNode x={250} y={266} w={250} h={96} kind="browser" title="localhost:5173/cart">
                        <div className="space-y-2 p-3">
                            <div className="h-2 w-24 rounded-full bg-text/15" />
                            <div className="h-2 w-40 rounded-full bg-text/10" />
                            <div className="h-5 w-20 rounded-md bg-accent/40" />
                        </div>
                    </MockNode>
                </div>
            </MockWindow>
        </MockStage>
    );
}

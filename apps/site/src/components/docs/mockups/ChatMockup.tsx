import type { ReactNode } from 'react';
import { MockStage } from './MockStage';
import { StatusPill } from './parts';

function Key({ children }: { readonly children: ReactNode }) {
    return <span className="mx-1 rounded-sm bg-surface-sunken px-1 text-text-muted">{children}</span>;
}

/* A chat view: a short thread, a permission request that arrives, and the composer with its model and permissions. */
export function ChatMockup() {
    return (
        <MockStage
            width={640}
            height={430}
            caption="An AI chat. The agent asks permission to run a command, and the card offers Deny and Allow. Below sits the composer, with the model and the permission mode beside it."
        >
            <div className="flex size-full flex-col bg-surface">
                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
                    <span className="grow text-xs font-medium text-text">Saved carts</span>
                    <StatusPill status="needs-you" pulse />
                </div>
                <div className="min-h-0 grow space-y-3 px-6 py-4 text-xs">
                    <div className="ml-auto w-fit max-w-96 rounded-xl bg-surface-raised px-3 py-2 text-text">
                        Add saved carts as described in the brief, and push the branch when the tests pass.
                    </div>
                    <div className="space-y-1 text-text-faint">
                        <div>Read 4 files</div>
                        <div>Edited src/cart.ts, src/session.ts</div>
                        <div>Ran bun test · 50 pass</div>
                    </div>
                    <div className="text-text-muted">Saved carts work, and the tests pass. I will push the branch now.</div>
                    <div className="mock-appear rounded-xl border border-status-needs-you/40 bg-surface-raised px-4 py-3" style={{ animationDelay: '0.8s' }}>
                        <div className="text-2xs font-medium text-status-needs-you">Permission request</div>
                        <div className="mt-1 text-text">Run command</div>
                        <div className="mt-2 rounded-md bg-surface-sunken px-2.5 py-1.5 font-mono text-2xs text-text">git push origin saved-carts</div>
                        <div className="mt-3 flex justify-end gap-2 text-2xs font-medium">
                            <span className="rounded-md border border-border px-3 py-1 text-text">Deny</span>
                            <span className="rounded-md bg-text px-3 py-1 text-bg">Allow</span>
                        </div>
                    </div>
                </div>
                <div className="m-3 mt-0 rounded-xl border border-border bg-bg px-3 py-2.5">
                    <div className="text-xs text-text-faint">
                        Ask anything, or<Key>/</Key>commands<Key>@</Key>files<Key>$</Key>skills
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-2xs text-text-muted">
                        <span className="rounded-md bg-text/7 px-2 py-0.5">Claude Opus</span>
                        <span className="rounded-md bg-text/7 px-2 py-0.5">Supervised</span>
                    </div>
                </div>
            </div>
        </MockStage>
    );
}

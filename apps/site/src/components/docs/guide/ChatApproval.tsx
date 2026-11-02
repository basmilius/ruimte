'use client';

import { Hash, Terminal } from 'lucide-react';
import { ApprovalCard, AssistantText, Composer, ToolRow, UserBubble, WorkingRow } from '../../app/chat.tsx';
import { AppWindow, Rail, Sidebar, TopRow } from '../../app/chrome.tsx';
import { Reveal } from '../../app/primitives.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1400, 2200, 2600, 400, 3600] as const;

/* A chat view: the agent works, asks to run a command inside the composer, the person allows it and the agent goes on. */
export function ChatApproval() {
    return (
        <Stage
            width={960}
            height={600}
            label="An AI chat as a view. The agent reads and edits files, then asks to run git push. The request shows in the composer with Always allow, Deny and Allow. After Allow, the agent pushes the branch."
        >
            <ChatScene />
        </Stage>
    );
}

function ChatScene() {
    const step = useTimeline(STEPS);
    const asking = step === 2 || step === 3;
    const status = asking ? 'needs-you' : step === 4 ? 'idle' : 'running';

    return (
        <div className="absolute inset-0">
            <AppWindow
                sidebar={
                    <Sidebar
                        waiting={asking ? [{ id: 'waiting', name: 'Saved carts', icon: 'claude', status: 'needs-you' }] : []}
                        rows={[
                            { id: 'checkout', name: 'Checkout', icon: Hash },
                            { id: 'chat', name: 'Saved carts', icon: 'claude', status, selected: true },
                            { id: 'dev', name: 'dev server', icon: Terminal }
                        ]}
                    />
                }
                toolbar={<TopRow view={{ icon: 'claude', name: 'Saved carts' }} />}
                rail={<Rail />}
            >
                <div className="absolute inset-0 flex flex-col bg-surface">
                    <div className="mx-auto flex min-h-0 w-full max-w-[560px] grow flex-col gap-3 overflow-hidden pt-6">
                        <UserBubble>Add saved carts as the brief says, and push the branch when the tests pass.</UserBubble>
                        <Reveal shown={step >= 1}>
                            <ToolRow tool="read" label="Read" detail="src/cart.ts" />
                            <ToolRow tool="edit" label="Edit" detail="src/cart.ts" />
                            <ToolRow tool="bash" label="Ran" detail="bun test" />
                        </Reveal>
                        <AssistantText shown={step >= 2} text="Saved carts work and all 50 tests pass. I'll push the branch now." />
                        <Reveal shown={step === 4}>
                            <ToolRow tool="bash" label="Ran" detail="git push origin saved-carts" />
                        </Reveal>
                        {status === 'running' && <WorkingRow seconds={step * 8 + 5} />}
                    </div>
                    <div className="mx-auto w-full max-w-[600px] px-4 pb-5">
                        <Composer prompt={asking ? <ApprovalCard cwd="~/acme-web" command="git push origin saved-carts" pressed={step === 3} /> : undefined} />
                    </div>
                </div>
            </AppWindow>
        </div>
    );
}

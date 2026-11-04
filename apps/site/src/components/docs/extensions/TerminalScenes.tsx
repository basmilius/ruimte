'use client';

import { AssistantText, ToolRow, UserBubble } from '../../app/chat.tsx';
import { WindowBar } from '../../app/chrome.tsx';
import { Scaled } from '../../film/Stage.tsx';
import { SceneFrame } from './parts.tsx';

/* A chat that finds the extension's tool and runs it, then answers from what the tool said. */
export function AgentTool() {
    return (
        <Scaled
            width={760}
            height={250}
            label="A chat. The person asks which tickets are open. The agent calls tool_list, then tool_run with acme.tickets/tickets, and answers with the two open tickets."
        >
            <SceneFrame>
                <div className="flex grow flex-col gap-3 px-8 pt-7">
                    <UserBubble>Which tickets are still open?</UserBubble>
                    <div className="flex flex-col">
                        <ToolRow tool="read" label="Used" detail="tool_list" />
                        <ToolRow tool="read" label="Used" detail={`tool_run acme.tickets/tickets {"state":"open"}`} />
                    </div>
                    <AssistantText
                        shown
                        text="Two are open: ACME-412, the login form forgets the email, and ACME-418, the Safari button stays disabled. Shall I start on 412?"
                    />
                </div>
            </SceneFrame>
        </Scaled>
    );
}

/* What `ruimte extension dev` prints while you work: each build, then the log of both parts. */
export function DevLog() {
    return (
        <Scaled
            width={760}
            height={300}
            label="A terminal running bun run dev. It prints that Standup is loaded and is watching for changes, then a line from the client part marked [client] and two lines from the server part."
        >
            <SceneFrame>
                <WindowBar />
                <div className="grow bg-term-bg px-4 py-3 font-mono text-[13px] leading-5 whitespace-pre text-term-fg">
                    <div className="text-term-dim">~/standup $ bun run dev</div>
                    <div>10:24:03 Standup is loaded</div>
                    <div>Watching for changes. Ctrl-C takes it out of Ruimte again.</div>
                    <div>[client] panel opened with 3 chats</div>
                    <div>synced 3 chats since 09:00</div>
                    <div>[client] error: the tracker answered 401</div>
                    <div>10:25:41 Standup is loaded</div>
                </div>
            </SceneFrame>
        </Scaled>
    );
}

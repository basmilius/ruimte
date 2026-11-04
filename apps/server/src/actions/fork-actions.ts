import { ToolRefusal } from '@adecore/agents/context';
import type { ActionHandlers } from '@ruimte/actions';
import { depthForOpening } from '../tools/depth.ts';
import { modeForOpening } from '../tools/mode.ts';
import { refuseOtherMachine } from '../tools/remote-node.ts';
import { hostService, agentCallOf, type ServerActionContext } from './context.ts';

export const forkActions: ActionHandlers<ServerActionContext> = {
    'chat.fork': async ({ chatId, turnId, title, branch }, call) => {
        const { host } = call.context;
        const caller = call.actor.id;
        if (chatId === caller) {
            throw new ToolRefusal('self-fork', `${chatId} is you; fork is for a chat you opened yourself`);
        }
        /* Only a chat the caller opened, as the daemon wrote it down: forking any chat it can read would
           let an agent copy a person's conversation, or a sibling's, into a child of its own. */
        if ((host.agents?.startedBy(chatId) ?? null) !== caller) {
            throw new ToolRefusal('not-yours', `${chatId} is not a node you opened; you only fork a chat you opened yourself`);
        }
        refuseOtherMachine(host, chatId);
        const forks = hostService(call.context, 'forks', 'fork-unavailable', 'This machine does not fork chats');
        const agentCall = agentCallOf(call);
        const depth = depthForOpening(agentCall, 'agent_start', 1);
        const result = await forks.fork(
            { chatId, turnId, ...(title == null ? {} : { title }), ...(branch == null ? {} : { branch }) },
            { id: caller, depth, ceiling: modeForOpening(agentCall, undefined), recount: () => depthForOpening(agentCall, 'agent_start', 1) }
        );
        return {
            output: {
                chatId: result.nodeId,
                nodeId: result.nodeId,
                viewId: result.viewId,
                chat: result.title,
                branch: result.worktree?.branch ?? null
            }
        };
    }
};

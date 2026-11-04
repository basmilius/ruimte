import { ToolRefusal } from '@adecore/agents/context';
import type { ActionHandlers } from '@ruimte/actions';
import { isAbsolutePath } from '@ruimte/contracts';
import { hostService, type ServerActionContext } from './context.ts';

export const projectProposalActions: ActionHandlers<ServerActionContext> = {
    'project.propose': async ({ name, folder, reason }, { actor, context }) => {
        const proposals = hostService(context, 'proposals', 'no-proposals', 'This machine keeps no suggestions of projects');
        if (!proposals.inChats(actor.id)) {
            throw new ToolRefusal(
                'not-in-chats',
                'A project is suggested from a chat in Chats; a chat that already lives in a project, and a terminal, have nothing to move'
            );
        }
        if (folder && !isAbsolutePath(folder)) {
            throw new ToolRefusal('folder-not-absolute', `${folder} is not an absolute path; name the full folder on this machine, or leave folder out`);
        }
        return { output: await proposals.propose({ chatId: actor.id, name, ...(folder ? { folder } : {}), reason }) };
    }
};

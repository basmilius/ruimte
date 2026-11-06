import i18next from 'i18next';
import { defineBehaviors, type Command } from '@/commands/behavior';
import type { GeneratedCommands } from '@/commands/generated';
import { CommandMoment } from '@/commands/moment';
import { issueStartDialog, pullRequestDialog } from '@/github/dialogs';
import { prReposOfCurrent } from '@/github/pr-repos';
import { hasPrWatch, stopPrWatch } from '@/github/pr-watch-actions';
import { shownChatOfNode } from '@/state/design-chat';
import { endpointOfNodeId } from '@/state/node-endpoint';
import { shownFolderOf, useProject } from '@/state/project';

/* The row that shows the pull request of one repository of a folder that holds several. */
export const PR_SHOW_IN_PREFIX = 'pr-show-in-';

/* The chat the one selected node acts as, and the machine it runs on. */
function selectedChat(moment: CommandMoment): { endpointId: string; chatId: string } | null {
    const { selected } = moment;
    const chatId = selected === undefined ? null : shownChatOfNode(selected);

    return selected === undefined || chatId === null ? null : { endpointId: endpointOfNodeId(selected.id), chatId };
}

export const GITHUB_BEHAVIORS = defineBehaviors({
    // A folder with several repositories has one row per repository instead (`githubPaletteRows`).
    'pr-show': {
        run: () => {
            const cwd = prReposOfCurrent()[0]?.path;
            const folder = cwd ?? shownFolderOf(useProject.getState().current);
            if (folder !== null) {
                pullRequestDialog.set({ cwd: folder });
            }
        },
        offered: (moment) => moment.folder !== null && prReposOfCurrent().length <= 1
    },
    'pr-watch-stop': {
        run: () => {
            const chat = selectedChat(new CommandMoment());
            if (chat !== null) {
                void stopPrWatch(chat.endpointId, chat.chatId);
            }
        },
        offered: (moment) => {
            const chat = selectedChat(moment);

            return chat !== null && hasPrWatch(chat.endpointId, chat.chatId);
        }
    },
    'issue-start': {
        run: () => issueStartDialog.set(true),
        offered: (moment) => moment.folder !== null && !moment.scratch && { hint: i18next.t('shell:chats.name') }
    }
});

export function githubPaletteRows(moment: CommandMoment): Command[] {
    const repos = prReposOfCurrent();
    if (moment.folder === null || repos.length <= 1) {
        return [];
    }

    return repos.map((repo) => ({
        id: `${PR_SHOW_IN_PREFIX}${repo.path}`,
        label: i18next.t('shell:palette.commands.showPullRequestIn', { repo: repo.label }),
        run: () => pullRequestDialog.set({ cwd: repo.path })
    }));
}

export const GITHUB_GENERATED: readonly GeneratedCommands[] = [{ prefix: PR_SHOW_IN_PREFIX, usage: 'prShowIn', palette: true }];

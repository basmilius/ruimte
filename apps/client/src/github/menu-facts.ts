import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import { prReposOfCurrent } from '@/github/pr-repos';
import { hasPrWatch } from '@/github/pr-watch-actions';
import { focusedCanvas } from '@/state/canvas';
import { currentEndpointId } from '@/state/current-endpoint';
import { shownChatOfNode } from '@/state/design-chat';
import { useDocument } from '@/state/document';

declare module '@/commands/menu-context' {
    interface MenuFacts {
        /* The repositories of the folder that stand on a branch, which a pull request hangs on. */
        prRepos: { path: string; label: string }[];
        /* The one selected node is a chat with a pull request watch on. */
        prWatch: boolean;
    }
}

export function githubFacts(_host: MenuHost): Pick<MenuFacts, 'prRepos' | 'prWatch'> {
    const canvas = focusedCanvas().getState();
    const selected = canvas.selection.length === 1 ? canvas.nodes[canvas.selection[0]!] : undefined;
    const chat = selected === undefined ? null : shownChatOfNode(selected);
    const view = useDocument.getState().views.find((candidate) => candidate.id === useDocument.getState().activeViewId);

    return {
        prRepos: prReposOfCurrent().map((repo) => ({ path: repo.path, label: repo.label })),
        prWatch: view?.kind === 'canvas' && chat !== null && hasPrWatch(currentEndpointId(), chat)
    };
}

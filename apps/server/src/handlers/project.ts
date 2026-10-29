import type { Dispatcher } from '../dispatcher.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { countProjectOpened, countViewShown } from '../stats/usage-stats.ts';
import { newInlineChat, removeInlineChat, showInlineChat, type InlineChatHost } from '../projects/inline-chat.ts';
import { newScratchChat, type ChatWritten } from '../projects/scratch-project.ts';
import { setProjectAccounts } from '../projects/project-accounts.ts';

export function registerProjectHandlers(dispatcher: Dispatcher, store: ProjectStore, written?: ChatWritten, inline?: InlineChatHost): void {
    dispatcher.register('project.sidebar', () => store.sidebar());
    dispatcher.register('project.list', async () => ({ projects: await store.list() }));

    dispatcher.register('project.open', async (payload, client) => {
        const opened = await store.openProject(payload);
        countProjectOpened(opened.summary.projectId);
        // Told after the open, so a client is only counted as watching a project it really got and is still there for.
        if (!client.closed) {
            store.hold(client.id, opened.summary.projectId);
        }
        return opened;
    });

    dispatcher.register('project.save', async (payload, client) => ({
        rev: await store.save(payload.projectId, payload.baseRev, payload.content, payload.shared, client.id)
    }));

    dispatcher.register('project.save-local', async (payload) => {
        await store.saveLocal(payload.projectId, payload.local);
        countViewShown(
            payload.projectId,
            payload.local.activeViewId,
            (viewId) => store.index.viewsOf(payload.projectId)?.find((view) => view.id === viewId)?.kind ?? null
        );
        return {};
    });

    /* The project id is the payload's, not this client's: closing a project a person is not looking
       at is the same act, and the daemon is the only one that knows who else still has it open. */
    dispatcher.register('project.close', (payload, client) => store.closeProject(payload.projectId, client.id));

    dispatcher.register('project.closing', (payload, client) => store.closing(client.id, payload.projectId));

    // Switching to another project on the same machine. The daemon lets go, but the list does not move.
    dispatcher.register('project.release', (payload, client) => {
        store.letGo(client.id, payload.projectId);
        return {};
    });

    dispatcher.register('project.setIcon', async (payload) => ({ summary: await store.setIcon(payload) }));

    dispatcher.register('project.setIdentity', async (payload) => ({ summary: await store.setIdentity(payload) }));

    dispatcher.register('project.setAccounts', async (payload) => ({ accounts: await setProjectAccounts(store, payload) }));

    dispatcher.register('project.newChat', (payload) => newScratchChat(store, payload, written));

    if (inline !== undefined) {
        dispatcher.register('project.newInlineChat', (payload) => newInlineChat(store, payload, inline));
        dispatcher.register('project.showInlineChat', async (payload) => {
            await showInlineChat(store, payload);
            return {};
        });
        dispatcher.register('project.removeInlineChat', async (payload) => {
            await removeInlineChat(store, payload, inline);
            return {};
        });
    }

    dispatcher.register('project.delete', async (payload) => {
        await store.delete(payload.projectId, payload.removeFiles);
        return {};
    });
}

import { CustomLanguageServerInputSchema, extensionChatOf } from '@ruimte/contracts';
import { extensionActionCall } from '../actions/context.ts';
import { extensionChatStarter } from '../extensions/extension-chat.ts';
import { ExtensionHost, type ExtensionAsks } from '../extensions/extension-host.ts';
import { runMachineAction, outputOf } from '../extensions/machine-actions.ts';
import { ExtensionRefusal } from '../extensions/refusal.ts';
import { ExtensionStore } from '../extensions/store.ts';
import { runExtensionPrompt, type ExtensionHandlerDeps } from '../handlers/extensions.ts';
import { markDrawnChat } from '../projects/drawn-chat.ts';
import type { DaemonBundles } from './bundles.ts';
import type { Later } from './later.ts';

const EXTENSION_QUERY_ROWS = 500;

export interface ExtensionsBundle {
    host: ExtensionHost;
    /* What the requests of `extension.*` read from the machine. */
    handlerDeps(): ExtensionHandlerDeps;
    /* The text of one chat, as `chats.read` and `extension.chatRead` give it. */
    readChat(chatId: string): Promise<string>;
    /* What an extension's own node says to the agent that reads it as context. */
    nodeText(extension: string, type: string, data: unknown): Promise<string | null>;
}

type ExtensionsLater = Later<Pick<DaemonBundles, 'agents' | 'providers' | 'projects' | 'databases' | 'artifacts' | 'language' | 'canvasHost' | 'actions'>>;

/*
 * The extension host with everything it asks of the machine, built before the machine is up: each
 * ask reaches the bundle that answers it through `later`, so none is patched in after the start.
 */
export function wireExtensions(home: string, later: ExtensionsLater): ExtensionsBundle {
    const index = () => later.projects().store.index;
    const readChat = async (chatId: string): Promise<string> =>
        (await later.agents().context.answerSource('extension', { id: chatId, kind: 'chat', title: chatId }, null, null)).text ?? '';
    const folderOfProject = (projectId: string): string => {
        const folder = index().folderOf(projectId);

        if (folder === null) {
            throw new ExtensionRefusal('not-found', `No project ${projectId} on this machine`);
        }

        return folder;
    };
    const asks: ExtensionAsks = {
        'agents.run': (options: { prompt: string; context?: string[]; provider?: string }) => runExtensionPrompt(later.providers().providers, options),
        'chats.send': async (chatId: string, text: string) => {
            await later.agents().chats.send(chatId, text);
        },
        'chats.list': async () => (await later.agents().chats.list()).map(extensionChatOf),
        'chats.read': readChat
    };
    const startChat = (...args: Parameters<ReturnType<typeof extensionChatStarter>>) =>
        extensionChatStarter({
            host: later.canvasHost(),
            actions: later.actions(),
            folderOf: (projectId) => index().folderOf(projectId),
            projectOfFolder: (folder) => index().projectOfFolder(folder),
            markDrawn: (projectId, viewId, extensionId) => markDrawnChat(later.projects().store, projectId, viewId, extensionId)
        })(...args);
    const host = new ExtensionHost({
        store: new ExtensionStore(home),
        asks: () => asks,
        startChat: async (...args) => startChat(...args),
        runAction: async (id, projectId, action, input) => {
            const folder = folderOfProject(projectId);
            const call = extensionActionCall(later.canvasHost(), { projectId, folder, canvasId: null }, id);

            return runMachineAction(
                action,
                input,
                async (name, translated) => outputOf(await later.actions().execute(name, translated, call)),
                (files) => later.artifacts().artifacts.publishFor(projectId, files)
            );
        },
        // Saved like one a person added, so it is listed in Settings and held when its file changes.
        addLanguageServer: async (id, server) => {
            const input = CustomLanguageServerInputSchema.safeParse({ args: [], ...server, id: undefined });

            if (!input.success) {
                throw new ExtensionRefusal('invalid-input', `defineLanguageServer takes another shape: ${input.error.issues[0]?.message ?? 'invalid'}`);
            }

            await later.language().host.customSaveFor(id, input.data);
        },
        removeLanguageServers: async (id) => later.language().host.customRemoveOwned(id),
        languageServerOwners: () => later.language().host.customOwners()
    });

    return {
        host,
        readChat,
        nodeText: async (extension, type, data) => {
            const parts = await host.nodeContext(extension, type, data);

            return Array.isArray(parts) ? parts.map((part: { text?: string }) => part.text ?? '').join('\n') : typeof parts === 'string' ? parts : null;
        },
        handlerDeps: () => ({
            viewsOf: (projectId) => index().viewsOf(projectId),
            folderOf: (projectId) => index().folderOf(projectId),
            readSource: async (source, projectId) => (await later.agents().context.answerSource('extension', source, null, null, projectId)).text ?? '',
            providers: later.providers().providers,
            databaseQuery: async (projectId, connection, sql) => {
                const folder = folderOfProject(projectId);
                const { result } = await later
                    .databases()
                    .agents.query({ projectId, folder }, 'extension', connection, sql, { schema: null, limit: EXTENSION_QUERY_ROWS });

                return {
                    columns: result.columns.map((column) => (typeof column === 'string' ? column : column.name)),
                    rows: result.rows.map((row) => [...row]),
                    hasMore: result.hasMore
                };
            }
        })
    };
}

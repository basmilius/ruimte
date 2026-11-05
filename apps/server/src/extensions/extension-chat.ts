import type { ActionRegistry } from '@ruimte/actions';
import { voiceActionCall, type ServerActionContext } from '../actions/context.ts';
import type { CanvasHost } from '../canvas/host.ts';
import type { ExtensionHostOptions } from './extension-host.ts';
import { outputOf } from './machine-actions.ts';
import { ExtensionRefusal } from './refusal.ts';

export interface ExtensionChatDeps {
    host: CanvasHost;
    actions: Pick<ActionRegistry<ServerActionContext>, 'execute'>;
    folderOf(projectId: string): string | null;
    projectOfFolder(folder: string): string | null;
    /* Takes the chat view out of the sidebar as one this extension draws, which leaves it an ordinary chat otherwise. */
    markDrawn(projectId: string, viewId: string, extensionId: string): Promise<void>;
}

/*
 * As Voice starts one: under the person's own CLI, an AI Chat and no wider than supervised, and with no canvas a view
 * of its own. `check` goes along into the action, which calls it after each of its own awaits, so a turn off while it
 * waits makes nothing. With a `folder` it starts in the project the machine knows there, as a view of that project,
 * since an extension is trusted code that a person chose to run.
 */
export function extensionChatStarter({
    host,
    actions,
    folderOf,
    projectOfFolder,
    markDrawn
}: ExtensionChatDeps): NonNullable<ExtensionHostOptions['startChat']> {
    return async (id, start, check) => {
        const elsewhere = start.folder === undefined ? null : projectOfFolder(start.folder);

        if (start.folder !== undefined && elsewhere === null) {
            throw new ExtensionRefusal('not-found', `No project in ${start.folder} on this machine`);
        }

        const projectId = elsewhere ?? start.projectId;
        // A canvas and a node beside it belong to the project the request came from, and a chat the extension draws stands on none.
        const { viewId, beside } = elsewhere === null && start.hidden !== true ? start : { viewId: undefined, beside: undefined };
        const { provider, title, prompt } = start;
        const folder = folderOf(projectId);

        if (folder === null) {
            throw new ExtensionRefusal('not-found', `No project ${projectId} on this machine`);
        }

        const kind = provider ?? (await host.starts.installedAgents())[0];

        if (kind === undefined) {
            throw new ExtensionRefusal('unavailable', 'No agent is set up on this machine');
        }

        check();

        const call = voiceActionCall(
            host,
            { projectId, folder, canvasId: viewId ?? null },
            {
                sessionId: `extension-${id}`,
                owner: { clientId: 'extension', sceneId: id },
                projectId,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            }
        );

        call.context.stillAllowed = check;

        const result = await actions.execute(
            'agent.start',
            {
                provider: kind,
                terminal: false,
                ...(prompt === undefined ? {} : { prompt }),
                ...(title === undefined ? {} : { title }),
                ...(viewId === undefined ? {} : { viewId }),
                ...(beside === undefined ? {} : { beside })
            },
            call
        );

        const { nodeId } = outputOf(result);

        if (start.hidden === true) {
            await markDrawn(projectId, nodeId, id);
        }

        return { nodeId };
    };
}

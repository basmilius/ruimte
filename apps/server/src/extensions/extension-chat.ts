import type { ActionRegistry } from '@ruimte/actions';
import { voiceActionCall, type ServerActionContext } from '../actions/context.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import type { ExtensionHostOptions } from './extension-host.ts';
import { outputOf } from './machine-actions.ts';
import { ExtensionRefusal } from './refusal.ts';

export interface ExtensionChatDeps {
    host: CanvasHost;
    actions: Pick<ActionRegistry<ServerActionContext>, 'execute'>;
    folderOf(projectId: string): string | null;
}

/*
 * As Voice starts one: under the person's own CLI, an AI Chat and no wider than supervised, and with no canvas a view
 * of its own. `check` goes along into the action, which calls it after each of its own awaits, so a turn off while it
 * waits makes nothing.
 */
export function extensionChatStarter({ host, actions, folderOf }: ExtensionChatDeps): NonNullable<ExtensionHostOptions['startChat']> {
    return async (id, { projectId, viewId, beside, provider, title, prompt }, check) => {
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

        return { nodeId: outputOf(result).nodeId };
    };
}

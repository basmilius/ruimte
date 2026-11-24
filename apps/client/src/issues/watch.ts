import { useHosts } from '@/issues/state';
import { endpointKey } from '@/state/keys';
import { offerPanel } from '@/state/offered-panels';
import { defaultProjectStore, isScratchProject } from '@/state/project';
import { pool, transportFor } from '@/transport';
import { fireAndForget } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';
import { watchPool } from '@/transport/pool-watch';

export const ISSUES_PANEL_KIND = 'issues';

interface OnScreen {
    endpointId: string;
    projectId: string;
}

/* The Chats project is the machine's own folder, which no host has issues for. */
function projectOnScreen(): OnScreen | null {
    const { current, currentEndpointId } = defaultProjectStore.getState();

    return current === null || currentEndpointId === null || isScratchProject(current) ? null : { endpointId: currentEndpointId, projectId: current.projectId };
}

function offerPanelOnScreen(): void {
    const open = projectOnScreen();
    const providers = open === null ? undefined : useHosts.getState().providers[endpointKey(open.endpointId, open.projectId)];

    offerPanel(ISSUES_PANEL_KIND, providers !== undefined && providers.length > 0);
}

/* A machine that does not name `host.status` is never asked, so a project on it has no hosts. */
function linkThatAnswers(endpointId: string): ReturnType<typeof transportFor> {
    return machineAnswers(pool.statusOf(endpointId), 'host.status') ? transportFor(endpointId) : null;
}

export async function readLinks(endpointId: string, projectId: string): Promise<void> {
    const link = linkThatAnswers(endpointId);

    if (link === null) {
        return;
    }

    const { links } = await link.request('host.links', { projectId });
    useHosts.getState().setLinks(endpointId, projectId, links);
}

/* Has the machine look again at which hosts answer for the project, and reads the links only where one does. */
export async function readHosts(endpointId: string, projectId: string): Promise<void> {
    const link = linkThatAnswers(endpointId);

    if (link === null) {
        return;
    }

    const { providers } = await link.request('host.status', { projectId });
    useHosts.getState().setProviders(endpointId, projectId, providers);
    offerPanelOnScreen();

    if (providers.length > 0) {
        await readLinks(endpointId, projectId);
    }
}

export async function readChatChange(endpointId: string, projectId: string, chatId: string): Promise<void> {
    const link = linkThatAnswers(endpointId);

    if (link === null) {
        return;
    }

    const { change } = await link.request('host.change', { projectId, chatId });
    useHosts.getState().setChange(endpointId, chatId, change);
}

/*
 * Which hosts answer for the project on screen, and the links of its chats, for as long as a workspace is up.
 * The rail and every chat read the answer from the store, so only this asks: once per project, again on a
 * fresh link, and when the extensions changed, since an extension is what supplies a host.
 */
export function startHostWatch(): () => void {
    const keyOnScreen = (): string | null => {
        const open = projectOnScreen();

        return open === null ? null : endpointKey(open.endpointId, open.projectId);
    };

    // The project already on screen is read by the first open link, so only a later one is read from `follow`.
    let last = keyOnScreen();

    const offPool = watchPool((link, endpointId) => {
        const onScreenHere = (): OnScreen | null => {
            const open = projectOnScreen();

            return open !== null && open.endpointId === endpointId ? open : null;
        };

        const read = (): void => {
            const open = onScreenHere();

            if (open !== null) {
                void fireAndForget('host.status', readHosts(endpointId, open.projectId));
            }
        };

        return {
            onOpen: read,
            subscriptions: [
                link.on('extension.changed', read),
                link.on('host.linksChanged', () => {
                    const open = onScreenHere();

                    if (open !== null && (useHosts.getState().providers[endpointKey(endpointId, open.projectId)] ?? []).length > 0) {
                        void fireAndForget('host.links', readLinks(endpointId, open.projectId));
                    }
                })
            ]
        };
    });

    const follow = (): void => {
        const open = projectOnScreen();
        const key = keyOnScreen();

        if (key === last) {
            return;
        }

        last = key;
        offerPanelOnScreen();

        if (open !== null) {
            void fireAndForget('host.status', readHosts(open.endpointId, open.projectId));
        }
    };

    const offProject = defaultProjectStore.subscribe(follow);

    return () => {
        offPool();
        offProject();
        useHosts.getState().clear();
        offerPanel(ISSUES_PANEL_KIND, false);
    };
}

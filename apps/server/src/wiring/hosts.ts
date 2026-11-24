import { basename } from 'node:path';
import { isCanvasView, type ProjectContent } from '@ruimte/contracts';
import type { HostCheckouts } from '../git/host-checkouts.ts';
import { Hosts } from '../hosts/hosts.ts';
import type { HostLinks } from '../hosts/links.ts';
import { HostWatches } from '../hosts/watches.ts';
import type { AgentsBundle } from './agents.ts';
import type { ExtensionsBundle } from './extensions.ts';
import type { ProjectsBundle } from './projects.ts';

export interface HostsBundle {
    hosts: Hosts;
    /* Made with the chats, whose sidecar it is. */
    links: HostLinks;
    watches: HostWatches;
    /* The chats of a project an issue counts: its chat nodes and its chat views. */
    chatsOf(projectId: string): Promise<string[]>;
    /* The project a chat is in; null for one this machine places nowhere. */
    projectOfChat(chatId: string): string | null;
}

interface HostsInput {
    extensions: ExtensionsBundle;
    agents: AgentsBundle;
    projects: ProjectsBundle;
    checkouts: HostCheckouts;
}

function chatsIn(content: ProjectContent): string[] {
    return content.views.flatMap((view) => {
        if (isCanvasView(view)) {
            return view.nodes.filter((node) => node.kind === 'chat').map((node) => node.id);
        }

        return view.kind === 'chat' ? [view.id] : [];
    });
}

/* The code hosts and issue trackers of the projects, read through the providers of the extensions. */
export function wireHosts({ extensions, agents, projects, checkouts }: HostsInput): HostsBundle {
    const { store } = projects;
    const { chats } = agents;
    const watches = new HostWatches();
    const hosts = new Hosts({
        providers: {
            list: () => extensions.host.hostProviders(),
            ask: (extension, provider, method, args) => extensions.host.askHostProvider(extension, provider, method, args),
            note: (extension, line) => extensions.host.noteProvider(extension, line)
        },
        projectOf: async (projectId) => {
            const folder = store.index.folderOf(projectId);

            if (folder === null) {
                return null;
            }

            const known = (await store.known()).find((entry) => entry.projectId === projectId);

            return { id: projectId, name: known?.name ?? basename(folder), folder };
        },
        checkouts,
        // A chat no window read for a while is out of memory, so its record answers; one that never started works in its project's folder.
        cwdOf: async (chatId) => chats.get(chatId)?.info.cwd ?? (await chats.readChat(chatId))?.info.cwd ?? store.index.locate(chatId)?.folder ?? null,
        changed: (projectId) => watches.changed(projectId)
    });

    return {
        hosts,
        links: agents.hostLinks,
        watches,
        chatsOf: async (projectId) => chatsIn(await store.read(projectId)),
        projectOfChat: (chatId) => store.index.locate(chatId)?.projectId ?? null
    };
}

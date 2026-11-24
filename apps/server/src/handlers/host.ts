import { CodedError } from '@adecore/agents';
import type { HostLink } from '@ruimte/contracts';
import type { Area } from '../area.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { errorText } from '../error-text.ts';
import type { Hosts } from '../hosts/hosts.ts';
import { linkOfIssue, type HostLinks } from '../hosts/links.ts';
import { branchOfRef, issuePrompt } from '../hosts/text.ts';
import type { HostWatches } from '../hosts/watches.ts';

interface HostDeps {
    hosts: Hosts;
    links: HostLinks;
    watches: HostWatches;
    /* The chats of a project: its chat nodes and its chat views, by id. */
    chatsOf(projectId: string): Promise<string[]>;
    projectOfChat(chatId: string): string | null;
}

/*
 * A client reads here what a person reads in the Issues panel, and links a chat to an issue for them. Nothing in this
 * area writes to a host: a write is a proposal a person confirms, which has requests of its own.
 */
export function hostArea(deps: HostDeps): Area {
    return {
        name: 'host',
        sources: [deps.watches, deps.links],
        handlers: (dispatcher) => registerRequests(dispatcher, deps)
    };
}

function registerRequests(dispatcher: Dispatcher, { hosts, links, watches, chatsOf, projectOfChat }: HostDeps): void {
    dispatcher.register('host.status', async ({ projectId }) => ({ providers: await hosts.status(projectId) }));

    dispatcher.register('host.issues', (payload) => hosts.issues(payload));

    dispatcher.register('host.issue', async ({ projectId, ref }) => ({ issue: await hosts.issue(projectId, ref) }));

    dispatcher.register('host.issuePrompt', async ({ projectId, ref }) => {
        const issue = await hosts.issue(projectId, ref);

        return { prompt: issuePrompt(issue), title: issue.title, branch: branchOfRef(ref) };
    });

    dispatcher.register('host.changes', (payload) => hosts.changes(payload));

    dispatcher.register('host.change', async ({ projectId, ref, chatId }) => {
        if (ref !== undefined) {
            return { change: await hosts.change(projectId, ref) };
        }

        if (chatId === undefined) {
            throw new CodedError('bad-request', 'host.change needs a ref or a chat');
        }

        return { change: await hosts.changeOfChat(projectId, chatId) };
    });

    dispatcher.register('host.checkLog', ({ projectId, ref, check }) => hosts.checkLog(projectId, ref, check));

    dispatcher.register('host.watch', ({ projectId, ref }, client) => {
        // A channel that went while this was on its way would leave a watch nobody hears.
        if (client.closed !== true) {
            watches.watch(client.id, ref === undefined ? { projectId } : { projectId, ref });
        }

        return {};
    });

    dispatcher.register('host.unwatch', ({ projectId, ref }, client) => {
        watches.unwatch(client.id, ref === undefined ? { projectId } : { projectId, ref });

        return {};
    });

    dispatcher.register('host.links', async ({ chatId, ref, projectId }): Promise<{ links: HostLink[] }> => {
        if (chatId !== undefined) {
            return { links: await links.of(chatId) };
        }

        if (ref !== undefined) {
            return { links: await links.chatsOf(ref) };
        }

        return { links: projectId === undefined ? [] : await links.ofChats(await chatsOf(projectId)) };
    });

    dispatcher.register('host.link', async ({ projectId, chatId, ref }) => {
        if (projectOfChat(chatId) !== projectId) {
            throw new CodedError('not-found', 'That chat is not in this project');
        }

        try {
            // Read now, so the link holds the issue as the host has it at this moment.
            return { link: await links.link(chatId, linkOfIssue(await hosts.issue(projectId, ref), 'person')) };
        } catch (e) {
            throw e instanceof CodedError ? e : new CodedError('link-refused', errorText(e));
        }
    });

    dispatcher.register('host.unlink', async ({ chatId, ref }) => ({ removed: await links.unlink(chatId, ref) }));
}

import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatSidecar } from '@adecore/agents/chat';
import { KeyedSerializer } from '@adecore/utils/async';
import { isNotFound } from '@adecore/utils/errors';
import { writeAtomic } from '@adecore/utils/fs';
import { HostLinkSchema, type HostIssueSummary, type HostLink, type HostRef } from '@ruimte/contracts';
import { homeFolder } from '@ruimte/service/home';
import { z } from 'zod';
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../wire.ts';

const SUFFIX = '.links.json';

// Past this a chat is linked to more issues than anyone reads on it, and an agent in a loop stops here.
export const MAX_LINKS_PER_CHAT = 50;

const StoredLinkSchema = HostLinkSchema.omit({ chatId: true });
const LinkFileSchema = z.object({ version: z.literal(1), links: z.array(StoredLinkSchema) });

type StoredLink = z.infer<typeof StoredLinkSchema>;

export function linkFileName(chatId: string): string {
    return `${encodeURIComponent(chatId)}${SUFFIX}`;
}

/* What a link keeps of an issue as it reads now, and who made the link. */
export function linkOfIssue(issue: HostIssueSummary, by: HostLink['by']): Omit<HostLink, 'chatId' | 'linkedAt'> {
    return {
        ref: issue.ref,
        title: issue.title,
        state: issue.state,
        ...(issue.stateLabel === undefined ? {} : { stateLabel: issue.stateLabel }),
        ...(issue.url === undefined ? {} : { url: issue.url }),
        by
    };
}

interface HostLinksOptions {
    now?: () => number;
}

/*
 * Which chat works on which issue, one file per chat beside its record under `$RUIMTE_HOME/chats`, so a link is one
 * person's and goes with the chat. A link holds the title and state of the issue as read when it was made; nothing
 * reads the host again for it. The other direction, the chats of an issue, is an index in memory built from those
 * files once. A sidecar of the chat core, which removes the file with the chat and copies it into a fork.
 */
export class HostLinks implements ChatSidecar {
    private readonly dir: string;
    private readonly now: () => number;
    private readonly writes = new KeyedSerializer();
    private readonly sinks = new ClientSinks();
    // The chats of each ref, filled from disk on the first ask and kept by every write after it.
    private index: Promise<Map<HostRef, Set<string>>> | null = null;

    constructor(home: string, options: HostLinksOptions = {}) {
        this.dir = homeFolder(home, 'chats');
        this.now = options.now ?? Date.now;
    }

    owns(name: string): boolean {
        return name.endsWith(SUFFIX);
    }

    /* Every client hears which chat's links changed, since an issue counts its chats whether or not one is open. */
    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* The issues a chat works on, oldest link first. */
    async of(chatId: string): Promise<HostLink[]> {
        return (await this.writes.run(chatId, () => this.readFile(chatId))).map((link) => ({ chatId, ...link }));
    }

    /* The chats that work on an issue, settled and unloaded ones included. */
    async chatsOf(ref: HostRef): Promise<HostLink[]> {
        const chats = [...((await this.indexed()).get(ref) ?? [])];

        return (await this.ofChats(chats)).filter((link) => link.ref === ref);
    }

    async ofChats(chatIds: readonly string[]): Promise<HostLink[]> {
        return (await Promise.all(chatIds.map((chatId) => this.of(chatId).catch(() => [])))).flat();
    }

    /* Links a chat to an issue as it reads now. A second link to the same issue replaces the first, so its title and state are the newer ones. */
    async link(chatId: string, link: Omit<HostLink, 'chatId' | 'linkedAt'>): Promise<HostLink> {
        const index = await this.indexed();
        const stored: StoredLink = { ...link, linkedAt: this.now() };

        await this.writes.run(chatId, async () => {
            const links = (await this.readFile(chatId)).filter((candidate) => candidate.ref !== link.ref);

            if (links.length >= MAX_LINKS_PER_CHAT) {
                throw new Error(`This chat is linked to ${MAX_LINKS_PER_CHAT} issues already, which is all a chat keeps`);
            }

            await this.writeFile(chatId, [...links, stored]);
        });

        index.set(link.ref, (index.get(link.ref) ?? new Set()).add(chatId));
        this.changed(chatId);

        return { chatId, ...stored };
    }

    async unlink(chatId: string, ref: HostRef): Promise<boolean> {
        const index = await this.indexed();
        const removed = await this.writes.run(chatId, async () => {
            const links = await this.readFile(chatId);
            const kept = links.filter((candidate) => candidate.ref !== ref);

            if (kept.length === links.length) {
                return false;
            }

            await this.writeFile(chatId, kept);

            return true;
        });

        if (removed) {
            index.get(ref)?.delete(chatId);
            this.changed(chatId);
        }

        return removed;
    }

    async removeChat(chatId: string): Promise<void> {
        const index = await this.indexed();

        await this.writes.run(chatId, () => rm(join(this.dir, linkFileName(chatId)), { force: true }));

        for (const chats of index.values()) {
            chats.delete(chatId);
        }

        this.changed(chatId);
    }

    /* A fork works on what its original worked on. */
    async copyChat(fromChatId: string, toChatId: string): Promise<void> {
        const index = await this.indexed();
        const links = await this.writes.run(fromChatId, () => this.readFile(fromChatId));

        if (links.length === 0) {
            return;
        }

        await this.writes.run(toChatId, () => this.writeFile(toChatId, links));

        for (const link of links) {
            index.set(link.ref, (index.get(link.ref) ?? new Set()).add(toChatId));
        }

        this.changed(toChatId);
    }

    private indexed(): Promise<Map<HostRef, Set<string>>> {
        this.index ??= this.readIndex();

        return this.index;
    }

    private async readIndex(): Promise<Map<HostRef, Set<string>>> {
        const index = new Map<HostRef, Set<string>>();
        let names: string[] = [];

        try {
            names = await readdir(this.dir);
        } catch (e) {
            if (!isNotFound(e)) {
                throw e;
            }
        }

        for (const name of names.filter((candidate) => candidate.endsWith(SUFFIX))) {
            const chatId = decodeURIComponent(name.slice(0, -SUFFIX.length));

            // A file that does not read costs its own chat its links, never the index of the others.
            for (const link of await this.readFile(chatId).catch(() => [])) {
                index.set(link.ref, (index.get(link.ref) ?? new Set()).add(chatId));
            }
        }

        return index;
    }

    private async readFile(chatId: string): Promise<StoredLink[]> {
        let raw: string;

        try {
            raw = await readFile(join(this.dir, linkFileName(chatId)), 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return [];
            }

            throw e;
        }

        // A file that does not parse is refused rather than read as empty, which the next write would make true.
        const parsed = LinkFileSchema.safeParse(JSON.parse(raw));

        if (!parsed.success) {
            throw new Error(`The links file of chat ${chatId} is not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`);
        }

        return parsed.data.links;
    }

    private async writeFile(chatId: string, links: readonly StoredLink[]): Promise<void> {
        const path = join(this.dir, linkFileName(chatId));

        if (links.length === 0) {
            await rm(path, { force: true });

            return;
        }

        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(path, JSON.stringify({ version: 1, links }));
    }

    private changed(chatId: string): void {
        this.sinks.emit({ event: 'host.linksChanged', payload: { chatId } });
    }
}

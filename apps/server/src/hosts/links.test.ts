import { describe, expect, test } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostIssueSummary } from '@ruimte/contracts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import type { SessionEvent } from '../wire.ts';
import { HostLinks, linkFileName, linkOfIssue, MAX_LINKS_PER_CHAT } from './links.ts';

const home = tempHomes('ruimte-host-links-');

function issue(id: string, title = 'Search is slow'): HostIssueSummary {
    return { ref: `tracker:${id}`, title, state: 'open', url: `https://tracker.test/${id}`, assignees: [], labels: [] };
}

async function linksIn(folder: string): Promise<{ links: HostLinks; heard: SessionEvent[] }> {
    let now = 1000;
    const links = new HostLinks(folder, { now: () => (now += 1) });
    const heard: SessionEvent[] = [];

    links.subscribe('client', (event) => heard.push(event));

    return { links, heard };
}

describe('the links between chats and issues', () => {
    test('keep an issue as it read when it was linked, per chat, and say which chats work on an issue', async () => {
        const { links, heard } = await linksIn(await home());

        expect(await links.link('chat-1', linkOfIssue(issue('ENG-12'), 'person'))).toEqual({
            chatId: 'chat-1',
            ref: 'tracker:ENG-12',
            title: 'Search is slow',
            state: 'open',
            url: 'https://tracker.test/ENG-12',
            linkedAt: 1001,
            by: 'person'
        });
        await links.link('chat-2', linkOfIssue(issue('ENG-12'), 'agent'));
        await links.link('chat-2', linkOfIssue(issue('ENG-13', 'Export a report'), 'agent'));

        expect((await links.of('chat-2')).map((link) => [link.ref, link.title, link.by])).toEqual([
            ['tracker:ENG-12', 'Search is slow', 'agent'],
            ['tracker:ENG-13', 'Export a report', 'agent']
        ]);
        expect((await links.chatsOf('tracker:ENG-12')).map((link) => link.chatId)).toEqual(['chat-1', 'chat-2']);
        expect((await links.ofChats(['chat-1', 'chat-9'])).map((link) => link.chatId)).toEqual(['chat-1']);
        expect(heard).toEqual([
            { event: 'host.linksChanged', payload: { chatId: 'chat-1' } },
            { event: 'host.linksChanged', payload: { chatId: 'chat-2' } },
            { event: 'host.linksChanged', payload: { chatId: 'chat-2' } }
        ]);
    });

    test('replace a link to the same issue with the issue as it reads now, and forget one that is unlinked', async () => {
        const { links } = await linksIn(await home());

        await links.link('chat-1', linkOfIssue(issue('ENG-12'), 'person'));
        await links.link('chat-1', linkOfIssue({ ...issue('ENG-12', 'Search is fast again'), state: 'closed' }, 'agent'));

        expect((await links.of('chat-1')).map((link) => [link.title, link.state, link.by])).toEqual([['Search is fast again', 'closed', 'agent']]);
        expect(await links.unlink('chat-1', 'tracker:ENG-12')).toBe(true);
        expect(await links.unlink('chat-1', 'tracker:ENG-12')).toBe(false);
        expect(await links.chatsOf('tracker:ENG-12')).toEqual([]);
    });

    test('find the chats of an issue again after a restart, from the files beside the chats', async () => {
        const folder = await home();

        await (await linksIn(folder)).links.link('chat/1', linkOfIssue(issue('ENG-12'), 'person'));

        const { links } = await linksIn(folder);

        expect((await links.chatsOf('tracker:ENG-12')).map((link) => link.chatId)).toEqual(['chat/1']);
        expect(links.owns(linkFileName('chat/1'))).toBe(true);
        expect(links.owns('chat-1.json')).toBe(false);
    });

    test('go with the chat, and into its fork', async () => {
        const folder = await home();
        const { links } = await linksIn(folder);

        await links.link('chat-1', linkOfIssue(issue('ENG-12'), 'person'));
        await links.copyChat('chat-1', 'fork-1');
        await links.copyChat('chat-empty', 'fork-2');

        expect((await links.chatsOf('tracker:ENG-12')).map((link) => link.chatId)).toEqual(['chat-1', 'fork-1']);

        await links.removeChat('chat-1');

        expect((await links.chatsOf('tracker:ENG-12')).map((link) => link.chatId)).toEqual(['fork-1']);
        expect(await readdir(join(folder, 'chats'))).toEqual([linkFileName('fork-1')]);
    });

    test('keep at most fifty per chat, and leave a file they cannot read as it is', async () => {
        const folder = await home();
        const { links } = await linksIn(folder);

        for (let index = 0; index < MAX_LINKS_PER_CHAT; index++) {
            await links.link('chat-1', linkOfIssue(issue(`ENG-${index}`), 'agent'));
        }

        await expect(links.link('chat-1', linkOfIssue(issue('ENG-100'), 'agent'))).rejects.toThrow(
            'This chat is linked to 50 issues already, which is all a chat keeps'
        );
        // One it holds already takes no new place.
        expect((await links.link('chat-1', linkOfIssue(issue('ENG-3'), 'person'))).by).toBe('person');

        await mkdir(join(folder, 'chats'), { recursive: true });
        await writeFile(join(folder, 'chats', linkFileName('chat-2')), '{"version":2}');

        await expect(links.link('chat-2', linkOfIssue(issue('ENG-12'), 'person'))).rejects.toThrow('The links file of chat chat-2 is not valid');
    });
});

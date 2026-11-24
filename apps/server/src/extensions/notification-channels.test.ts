import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationChannels, type ChannelNotification, type NotificationChannelHost } from './notification-channels.ts';

const NOTIFICATION: ChannelNotification = { title: 'Agent', body: 'Needs you', project: { id: 'project' }, node: { id: 'node' }, reason: 'needsYou' };
let home: string;
let supplied: { extension: string; id: string; title: string }[];
let delivered: string[];
let host: NotificationChannelHost;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-channels-'));
    supplied = [
        { extension: 'acme.pager', id: 'pager', title: 'Pager' },
        { extension: 'acme.board', id: 'board', title: 'Board' }
    ];
    delivered = [];
    host = {
        list: async () => supplied,
        deliver: async (extension, channel, notification) => {
            delivered.push(`${extension}:${channel}:${notification.reason}`);

            return true;
        }
    };
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

test('every channel is off until a person turns it on, and the switch survives a restart', async () => {
    const path = join(home, 'channels.json');
    const channels = new NotificationChannels(host, path);

    expect(await channels.list()).toEqual([
        { extension: 'acme.pager', id: 'pager', title: 'Pager', on: false },
        { extension: 'acme.board', id: 'board', title: 'Board', on: false }
    ]);
    channels.notify(NOTIFICATION);
    await channels.settled();
    expect(delivered).toEqual([]);

    channels.set('acme.pager', 'pager', true);
    expect((await new NotificationChannels(host, path).list()).map((channel) => channel.on)).toEqual([true, false]);
});

test('hands a notification only to the channels that are on and that an extension still supplies', async () => {
    const channels = new NotificationChannels(host);

    channels.set('acme.pager', 'pager', true);
    channels.set('acme.gone', 'gone', true);
    channels.notify(NOTIFICATION);
    await channels.settled();
    expect(delivered).toEqual(['acme.pager:pager:needsYou']);

    channels.set('acme.pager', 'pager', false);
    channels.notify({ ...NOTIFICATION, reason: 'done' });
    await channels.settled();
    expect(delivered).toEqual(['acme.pager:pager:needsYou']);
});

test('a channel that never settles holds up no other channel and no later notification', async () => {
    const hung = Promise.withResolvers<boolean>();
    const channels = new NotificationChannels({
        list: host.list,
        deliver: (extension, channel, notification) => (extension === 'acme.pager' ? hung.promise : host.deliver(extension, channel, notification))
    });

    channels.set('acme.pager', 'pager', true);
    channels.set('acme.board', 'board', true);
    channels.notify(NOTIFICATION);
    channels.notify({ ...NOTIFICATION, reason: 'limit' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toEqual(['acme.board:board:needsYou', 'acme.board:board:limit']);
    hung.resolve(false);
    await channels.settled();
});

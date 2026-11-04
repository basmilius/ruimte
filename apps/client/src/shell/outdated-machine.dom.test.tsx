import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { PROTOCOL_VERSION, REQUEST_SCHEMAS } from '@ruimte/contracts';
import { act } from 'react';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';
import { pool } from '@/transport';
import { LinkTransport, type Link, type LinkEvents } from '@/transport/link-transport';
import type { PooledTransport } from '@/transport/pool';
import { mount, until, type Mounted } from '../../testing/dom';

const OLDER = 'This machine runs an older Ruimte. Update Ruimte there, or restart it to pick up the update.';

// The harness is a web page, whose start screen waits for an account, so the row under test is the one in Settings > Machines.
const OUTDATED: Endpoint = {
    id: 'outdated-machine',
    label: 'Outdated machine',
    httpBaseUrl: 'http://127.0.0.1:1',
    wsBaseUrl: 'ws://127.0.0.1:1',
    reachability: 'lan',
    daemonId: null,
    daemonPublicKey: null
};

class MemoryLink implements Link {
    readonly sent: Array<{ id: string; type: string }> = [];
    readonly events: LinkEvents;

    constructor(events: LinkEvents) {
        this.events = events;
    }

    send(data: string): void {
        this.sent.push(JSON.parse(data) as { id: string; type: string });
    }

    close(): void {
        queueMicrotask(() => this.events.close(null));
    }

    /* The machine accepts the link and answers the protocol check with this. */
    answerInfo(result: Record<string, unknown>): void {
        this.events.open();
        this.events.message(JSON.stringify({ id: 'protocol', ok: true, result }));
    }
}

let page: Mounted;
let transport: LinkTransport;
let links: MemoryLink[];
let release: () => void;
let open: { mockRestore(): void };

beforeEach(async () => {
    links = [];
    // The backoff timer is real, so the test reconnects itself and never waits on it.
    transport = new LinkTransport('ws://machine/ws', (_url, events) => {
        const link = new MemoryLink(events);
        links.push(link);
        return link;
    });
    open = spyOn(pool as unknown as { open: () => PooledTransport }, 'open').mockImplementation(() => transport);
    useEndpoints.getState().add(OUTDATED);
    release = pool.hold(OUTDATED);
    useWindow.getState().setBooting(false);
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'machines' }));
    await until(() => links.length === 1);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    release();
    pool.drop(OUTDATED.id);
    useEndpoints.getState().remove(OUTDATED.id);
    transport.dispose();
    open.mockRestore();
});

test('a machine that names no features shows the older-Ruimte line, and opens once it names them', async () => {
    await act(async () => links[0]!.answerInfo({ protocol: PROTOCOL_VERSION, label: 'This computer' }));
    await until(() => document.body.textContent?.includes(OLDER) === true);
    // Only the check went over the link, so no request reached a machine that cannot judge it.
    expect(links[0]!.sent.map((frame) => frame.type)).toEqual(['endpoint.info']);

    await act(async () => transport.reconnect());
    await until(() => links.length === 2);
    await act(async () => links[1]!.answerInfo({ protocol: PROTOCOL_VERSION, features: Object.keys(REQUEST_SCHEMAS) }));
    await until(() => transport.status === 'open');
    await until(() => document.body.textContent?.includes(OLDER) !== true);
});

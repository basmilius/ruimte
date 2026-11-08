import { describe, expect, test } from 'bun:test';
import type { ConnectedClient } from '@ruimte/contracts';
import { CircleQuestionMark, Globe, Laptop, Plug, Server, Smartphone, Tablet } from 'lucide-react';
import { clientDescription, clientIcon, clientLabel, groupClients } from './machine-clients';

const NOW = Date.UTC(2026, 10, 8, 12);
const HOUR_MS = 60 * 60_000;

function client(fields: Partial<ConnectedClient>): ConnectedClient {
    return { id: 'client-1', access: 'account', reachability: 'lan', connectedAt: NOW - 2 * HOUR_MS, current: false, ...fields };
}

describe('clientIcon', () => {
    test('draws the device before the app, the first match winning', () => {
        expect(clientIcon(client({ access: 'mcp', client: 'mcp' }))).toBe(Plug);
        expect(clientIcon(client({ access: 'machine', device: 'phone' }))).toBe(Server);
        expect(clientIcon(client({ client: 'station', device: 'phone' }))).toBe(Smartphone);
        expect(clientIcon(client({ client: 'ios' }))).toBe(Smartphone);
        expect(clientIcon(client({ client: 'ios', device: 'tablet' }))).toBe(Tablet);
        expect(clientIcon(client({ client: 'station', device: 'desktop' }))).toBe(Globe);
        expect(clientIcon(client({ client: 'browser' }))).toBe(Globe);
        expect(clientIcon(client({ client: 'desktop' }))).toBe(Laptop);
        expect(clientIcon(client({ client: 'android', device: 'desktop' }))).toBe(Laptop);
        expect(clientIcon(client({ client: 'android', device: 'watch' }))).toBe(CircleQuestionMark);
        expect(clientIcon(client({}))).toBe(CircleQuestionMark);
    });
});

describe('clientLabel', () => {
    test('names each app the way a person knows it', () => {
        expect(clientLabel(client({ client: 'desktop', os: 'macos' }))).toBe('Ruimte for Mac');
        expect(clientLabel(client({ client: 'desktop', os: 'haiku' }))).toBe('Ruimte');
        expect(clientLabel(client({ client: 'ios', device: 'phone' }))).toBe('iPhone');
        expect(clientLabel(client({ client: 'ios', device: 'tablet' }))).toBe('iPad');
        expect(clientLabel(client({ client: 'station' }))).toBe('station.ruimte.app');
        expect(clientLabel(client({ client: 'browser' }))).toBe('Browser');
        expect(clientLabel(client({ access: 'machine' }))).toBe('Another machine');
        expect(clientLabel(client({ access: 'mcp', label: 'claude.ai' }))).toBe('MCP · claude.ai');
        expect(clientLabel(client({}))).toBe('Unknown app');
    });
});

describe('clientDescription', () => {
    test('says the session, system, release, reach and time, and leaves out what is unknown', () => {
        const phone = client({ client: 'ios', label: "Bas's iPhone", os: 'ios', osVersion: '27.1', version: '0.31.0' });
        expect(clientDescription({ client: phone, count: 1 }, NOW)).toBe("Bas's iPhone · iOS 27.1 · 0.31.0 · Local network · connected 2h ago");
        expect(clientDescription({ client: client({ reachability: 'loopback' }), count: 2 }, NOW)).toBe(
            'Unknown version · This computer · connected 2h ago · 2 connections'
        );
        expect(clientDescription({ client: client({ reachability: 'public' }), count: 1 }, NOW)).toContain('Internet');
    });

    test('an external MCP client says when it made its last request', () => {
        const external = client({ access: 'mcp', reachability: undefined, connectedAt: NOW - 120_000, lastRequestAt: NOW - 120_000 });
        expect(clientDescription({ client: external, count: 1 }, NOW)).toBe('Last request 2m ago');
    });
});

describe('groupClients', () => {
    test('makes one row of connections equal on everything but id and time, current when any is', () => {
        const groups = groupClients([
            client({ id: 'client-1', client: 'desktop', connectedAt: NOW - HOUR_MS }),
            client({ id: 'client-2', client: 'desktop', connectedAt: NOW - 3 * HOUR_MS, current: true }),
            client({ id: 'client-3', client: 'station' })
        ]);

        expect(groups.map(({ client: row, count }) => ({ id: row.id, count, connectedAt: row.connectedAt, current: row.current }))).toEqual([
            { id: 'client-1', count: 2, connectedAt: NOW - 3 * HOUR_MS, current: true },
            { id: 'client-3', count: 1, connectedAt: NOW - 2 * HOUR_MS, current: false }
        ]);
    });

    test('keeps every external MCP client a row of its own', () => {
        expect(
            groupClients([client({ id: 'external-a', access: 'mcp', label: 'Bot' }), client({ id: 'external-b', access: 'mcp', label: 'Bot' })])
        ).toHaveLength(2);
    });
});

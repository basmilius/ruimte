import { formatAgo } from '@adecore/ui/format';
import type { ConnectedClient } from '@ruimte/contracts';
import i18next from 'i18next';
import { CircleQuestionMark, Globe, Laptop, Plug, Server, Smartphone, Tablet, type LucideIcon } from 'lucide-react';

/* One row of the list: connections that differ only in id and time, with the earliest time. */
export interface ClientGroup {
    readonly client: ConnectedClient;
    readonly count: number;
}

/* Product and system names, which no language translates. */
const SYSTEMS: Record<string, string> = {
    macos: 'macOS',
    windows: 'Windows',
    linux: 'Linux',
    ios: 'iOS',
    ipados: 'iPadOS',
    android: 'Android',
    chromeos: 'ChromeOS'
};

const DESKTOP_APPS: Record<string, string> = { macos: 'Ruimte for Mac', windows: 'Ruimte for Windows', linux: 'Ruimte for Linux' };

const STATION_HOST = 'station.ruimte.app';

function t(key: string, values?: Record<string, unknown>): string {
    return i18next.t(`settings:machine.clients.${key}`, values);
}

/* The device goes before the app, so Station on a phone draws a phone while its label still says Station. */
export function clientIcon({ access, device, client }: ConnectedClient): LucideIcon {
    if (access === 'mcp') {
        return Plug;
    }

    if (access === 'machine') {
        return Server;
    }

    if (device === 'phone' || (client === 'ios' && device === undefined)) {
        return Smartphone;
    }

    if (device === 'tablet') {
        return Tablet;
    }

    if (client === 'station' || client === 'browser') {
        return Globe;
    }

    if (client === 'desktop' || device === 'desktop') {
        return Laptop;
    }

    return CircleQuestionMark;
}

export function clientLabel({ access, client, os, device, label }: ConnectedClient): string {
    if (access === 'mcp') {
        return `MCP · ${label ?? ''}`;
    }

    if (access === 'machine') {
        return t('machine');
    }

    switch (client) {
        case 'desktop':
            return DESKTOP_APPS[os ?? ''] ?? 'Ruimte';
        case 'ios':
            return device === 'tablet' ? 'iPad' : 'iPhone';
        case 'station':
            return STATION_HOST;
        case 'browser':
            return t('browser');
        default:
            return t('unknown');
    }
}

function reachWords(reachability: ConnectedClient['reachability']): string | null {
    switch (reachability) {
        case undefined:
            return null;
        case 'loopback':
            return t('reach.loopback');
        case 'lan':
            return t('reach.lan');
        default:
            return t('reach.internet');
    }
}

/* What is unknown is left out, except a version: a client that sent none says so. */
export function clientDescription({ client, count }: ClientGroup, now: number): string {
    if (client.access === 'mcp') {
        return t('lastRequest', { ago: formatAgo(now - (client.lastRequestAt ?? client.connectedAt)) });
    }

    const system = client.os === undefined ? null : [SYSTEMS[client.os] ?? client.os, client.osVersion].filter((part) => part !== undefined).join(' ');
    const parts = [
        client.access === 'machine' ? null : (client.label ?? null),
        system,
        client.access === 'machine' ? null : (client.version ?? t('unknownVersion')),
        reachWords(client.reachability),
        t('connected', { ago: formatAgo(now - client.connectedAt) }),
        count > 1 ? t('connections', { count }) : null
    ];

    return parts.filter((part) => part !== null).join(' · ');
}

/* Connections equal on everything but `id` and `connectedAt` become one row, current when any of them is. */
export function groupClients(clients: readonly ConnectedClient[]): ClientGroup[] {
    const groups = new Map<string, { client: ConnectedClient; count: number }>();

    for (const client of clients) {
        const { id: _id, connectedAt: _connectedAt, current: _current, lastRequestAt: _lastRequestAt, ...rest } = client;
        // An external MCP client is one row per credential, with the time of its own last request.
        const key = client.access === 'mcp' ? client.id : JSON.stringify(Object.entries(rest).sort(([left], [right]) => left.localeCompare(right)));
        const group = groups.get(key);

        if (group === undefined) {
            groups.set(key, { client, count: 1 });
            continue;
        }

        group.count += 1;
        group.client = {
            ...group.client,
            connectedAt: Math.min(group.client.connectedAt, client.connectedAt),
            current: group.client.current || client.current
        };
    }

    return [...groups.values()];
}

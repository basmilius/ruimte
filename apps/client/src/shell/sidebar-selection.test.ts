import { expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import type { Endpoint } from '@/state/endpoints';
import { sidebarSelection } from './sidebar-selection';

const endpoint = (id: string): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: '',
    wsBaseUrl: '',
    token: null,
    daemonId: id,
    daemonPublicKey: null,
    reachability: 'lan'
});
const summary = (projectId: string, available = true, closedAt: number | null = null): ProjectSummary => ({
    projectId,
    name: projectId,
    available,
    closedAt,
    lastOpenedAt: 0,
    folder: '/repo',
    color: '#123456',
    nameSource: 'chosen',
    icon: { kind: 'initial', value: 'P' }
});

test('a paired machine without open projects is not part of the sidebar selection', () => {
    const rows = sidebarSelection([{ endpointId: 'mac', summary: summary('Skills') }], [endpoint('mac'), endpoint('vps')], null);
    expect(rows.map((row) => row.endpointId)).toEqual(['mac']);
});

test('closed and unavailable projects are excluded exactly like the project menu', () => {
    const rows = sidebarSelection(
        [
            { endpointId: 'mac', summary: summary('Skills') },
            { endpointId: 'mac', summary: summary('Ruimte Rust', false) },
            { endpointId: 'vps', summary: summary('Closed', true, 123) }
        ],
        [endpoint('mac'), endpoint('vps')],
        null
    );
    expect(rows.map((row) => row.summary.projectId)).toEqual(['Skills']);
});

test('an open project on another machine participates, while an unknown machine does not', () => {
    const rows = sidebarSelection(
        [
            { endpointId: 'mac', summary: summary('Skills') },
            { endpointId: 'vps', summary: summary('Website') },
            { endpointId: 'removed', summary: summary('Old') }
        ],
        [endpoint('mac'), endpoint('vps')],
        null
    );
    expect(rows.map((row) => row.endpointId)).toEqual(['mac', 'vps']);
});

test('the active project remains visible until its project-list response arrives', () => {
    const current = { endpointId: 'mac', summary: summary('Skills', false) };
    expect(sidebarSelection([], [endpoint('mac')], current).map((row) => row.summary.projectId)).toEqual(['Skills']);
});

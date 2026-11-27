import { expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import type { StorageTarget } from '@/state/other-windows';
import { fakeStorage } from '../project/fixtures';
import { followReopenedProjects, forgetClosedProject, rememberClosedProject, withClientClosedProject } from './closed-projects';

const summary: ProjectSummary = {
    projectId: 'project',
    name: 'Project',
    color: '#000',
    folder: '/repo',
    lastOpenedAt: 10,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'P' },
    nameSource: 'chosen'
};

test('an offline close survives fresh daemon lists until this client opens the project again', () => {
    const storage = fakeStorage(new Map());
    rememberClosedProject('vps', 'project', storage, 20);
    expect(withClientClosedProject('vps', summary, storage).closedAt).toBe(20);
    expect(withClientClosedProject('other', summary, storage).closedAt).toBeNull();
    expect(withClientClosedProject('vps', { ...summary, lastOpenedAt: 30 }, storage).closedAt).toBe(20);
    forgetClosedProject('vps', 'project', storage);
    expect(withClientClosedProject('vps', summary, storage).closedAt).toBeNull();
});

test('another window that opens a closed project tells this one which machine to ask again', () => {
    const listeners = new Set<(event: StorageEvent) => void>();
    const target = {
        addEventListener: (_type: string, listener: (event: StorageEvent) => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: StorageEvent) => void) => listeners.delete(listener)
    } as unknown as StorageTarget;
    const fire = (key: string | null, newValue: string | null): void => listeners.forEach((listener) => listener({ key, newValue } as StorageEvent));
    const reopened: string[] = [];
    const stop = followReopenedProjects((endpointId) => reopened.push(endpointId), target);

    fire('ruimte.closedProject.["vps","project"]', '20');
    fire('ruimte.theme', null);
    fire(null, null);
    fire('ruimte.closedProject.["vps","project"]', null);
    stop();
    fire('ruimte.closedProject.["local","other"]', null);

    expect(reopened).toEqual(['vps']);
});

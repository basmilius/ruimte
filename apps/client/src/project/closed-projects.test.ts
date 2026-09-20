import { expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import { forgetClosedProject, rememberClosedProject, withClientClosedProject } from './closed-projects';

const summary: ProjectSummary = {
    projectId: 'project',
    name: 'Project',
    color: '#000',
    folder: null,
    lastOpenedAt: 10,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'P' },
    nameSource: 'chosen'
};

test('an offline close survives fresh daemon lists until this client opens the project again', () => {
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
        removeItem: (key: string) => {
            values.delete(key);
        }
    };
    rememberClosedProject('vps', 'project', storage, 20);
    expect(withClientClosedProject('vps', summary, storage).closedAt).toBe(20);
    expect(withClientClosedProject('other', summary, storage).closedAt).toBeNull();
    expect(withClientClosedProject('vps', { ...summary, lastOpenedAt: 30 }, storage).closedAt).toBe(20);
    forgetClosedProject('vps', 'project', storage);
    expect(withClientClosedProject('vps', summary, storage).closedAt).toBeNull();
});

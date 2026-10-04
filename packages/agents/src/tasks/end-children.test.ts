import { describe, expect, test } from 'bun:test';
import { endChildren, type EndChildrenDeps, type EndChildrenEntry } from './end-children.ts';
import type { AnyOutboxEntry } from './task-work.ts';

function fakeDeps(tree: Record<string, string[]>, entries: AnyOutboxEntry[] = [], extra: Partial<EndChildrenDeps> = {}) {
    const calls: string[] = [];
    const ended = new Set<string>();
    const descendants = (nodeId: string): string[] => {
        const found: string[] = [];
        const walk = (id: string): void => {
            for (const child of tree[id] ?? []) {
                if (!ended.has(child)) {
                    found.push(child);
                }
            }
            for (const child of tree[id] ?? []) {
                walk(child);
            }
        };
        walk(nodeId);
        return found.filter((id) => !ended.has(id));
    };
    const deps: EndChildrenDeps = {
        lineage: {
            descendants,
            projectOf: () => 'project',
            markEnded: async (ids) => {
                calls.push(`mark ${ids.join(',')}`);
                ids.forEach((id) => ended.add(id));
            }
        },
        tasks: {
            cancelOpen: async (ids, reason) => {
                calls.push(`cancel ${[...ids].join(',')} (${reason})`);
                return [];
            },
            dropWake: async (id) => {
                calls.push(`drop wake ${id}`);
            }
        },
        outbox: {
            list: () => entries,
            enqueue: async (_projectId, target, work) => {
                calls.push(`owe ${target} ${JSON.stringify(work.payload)}`);
            },
            remove: async (id) => {
                calls.push(`remove ${id}`);
            }
        },
        // The host's own kinds, as Ruimte hands in its resumes and messages.
        reviving: ['resume-run', 'deliver-message'],
        reason: 'stopped',
        stop: async (id, reason) => {
            calls.push(`stop ${id} (${reason})`);
        },
        ...extra
    };
    return { calls, deps };
}

function entry(nodeIds: string[]): EndChildrenEntry {
    return {
        kind: 'end-children',
        id: 'end-children-1',
        projectId: 'project',
        target: 'lead',
        createdAt: 1,
        attempts: 0,
        notBefore: 1,
        payload: { nodeIds }
    };
}

describe('ending a node and the ones it opened', () => {
    test('marks first, takes away what would revive a child, cancels, then stops the leaves before their parents', async () => {
        const resume: AnyOutboxEntry = {
            kind: 'resume-run',
            id: 'resume-1',
            projectId: 'project',
            target: 'child',
            createdAt: 0,
            attempts: 0,
            notBefore: 0,
            payload: { turnId: 't', attempt: 2 }
        };
        const other: AnyOutboxEntry = { ...resume, id: 'resume-2', target: 'stranger' };
        // A message or a task that reached the outbox before the stop would start the CLI again on its own.
        const message: AnyOutboxEntry = { ...resume, kind: 'deliver-message', id: 'message-1', target: 'grandchild', payload: { from: 'lead' } };
        const task: AnyOutboxEntry = { ...resume, kind: 'give-task', id: 'task-1', target: 'child', payload: { taskId: 'task-a' } };
        // Work the host did not name as reviving stays.
        const limit: AnyOutboxEntry = { ...resume, kind: 'resume-limit', id: 'limit-1', target: 'child', payload: { turnId: 't' } };
        const { calls, deps } = fakeDeps({ lead: ['child'], child: ['grandchild'] }, [resume, other, message, task, limit]);
        await endChildren(deps).handler(entry(['child']));
        expect(calls).toEqual([
            'mark child,grandchild',
            'remove resume-1',
            'remove message-1',
            'remove task-1',
            'cancel child,grandchild (stopped)',
            'drop wake child',
            'drop wake grandchild',
            'stop grandchild (stopped)',
            'stop child (stopped)'
        ]);
        // Run again after a restart halfway, it ends the same nodes out of what the entry held.
        calls.length = 0;
        await endChildren(deps).handler(entry(['child']));
        expect(calls).toEqual(['mark child', 'remove resume-1', 'remove task-1', 'cancel child (stopped)', 'drop wake child', 'stop child (stopped)']);
    });

    test('owes nothing for a node that opened no agents', async () => {
        const { calls, deps } = fakeDeps({});
        expect(await endChildren(deps).owe('lead')).toBe(0);
        expect(calls).toEqual([]);
    });

    test('owes the descendants once, or the nodes a target names that it did not open', async () => {
        const owedEntry = entry(['child']);
        const { calls, deps } = fakeDeps({ lead: ['child'], child: ['grandchild'] });
        const ending = endChildren(deps);
        expect(await ending.owe('lead')).toBe(2);
        expect(await ending.owe('film', ['chat-a', 'chat-b'])).toBe(2);
        expect(calls).toEqual(['owe lead {"nodeIds":["child","grandchild"]}', 'owe film {"nodeIds":["chat-a","chat-b"]}']);

        const again = fakeDeps({ lead: ['child'] }, [owedEntry]);
        expect(await endChildren(again.deps).owe('lead')).toBe(1);
        expect(again.calls).toEqual([]);
    });

    test("ends only the nodes it is given with the caller's reason, and hands them to the host's clean-up after", async () => {
        const { calls, deps } = fakeDeps({ lead: ['child'] }, [], {
            ended: async (ids) => {
                calls.push(`clean up ${ids.join(',')}`);
            }
        });
        await endChildren(deps).end(['lead'], 'stopped from the list');
        expect(calls).toEqual(['mark lead', 'cancel lead (stopped from the list)', 'drop wake lead', 'stop lead (stopped from the list)', 'clean up lead']);
    });
});

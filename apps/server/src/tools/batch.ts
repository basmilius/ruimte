import { ToolRefusal } from '@adecore/agents/context';
import { MAX_PER_CALL } from '@ruimte/actions';
import { z } from 'zod';
import { placeOf, type AgentCall, type ProjectHost } from '../canvas/host.ts';

/* What every tool that changes several at once says of it, so an agent reaches for the one call and not a loop. */
export const ONE_WRITE = 'one write of the project, one update on every screen, and the call changes all of them or, refused, none';

/*
 * A field of ids, at most as many as one call changes, in the order given and without the repeats:
 * naming a node twice is one node, the way a person's selection holds it once.
 */
export function idsInput(field: string, what: string) {
    return z
        .array(z.string().trim().min(1, `${field} has an empty id in it`), { error: `${field} needs the ids of the ${what}` })
        .min(1, `${field} needs the ids of the ${what}`)
        .max(MAX_PER_CALL, `${field} takes at most ${MAX_PER_CALL} ids at once; split the rest over another call`)
        .transform((ids) => [...new Set(ids)]);
}

/* The objects of a `json` field, refused by the place in the array of the one that is wrong, never dropped. */
export function jsonBatch<Item extends z.ZodType>(json: string, item: Item, example: string, what: string): z.output<Item>[] {
    let parsed: unknown;

    try {
        parsed = JSON.parse(json);
    } catch {
        throw new ToolRefusal('bad-json', `json is not JSON; it takes an array of ${what}s`, [`example\t${example}`]);
    }

    const result = z
        .array(item, { error: `json needs an array of ${what}s` })
        .min(1, `json needs at least one ${what}`)
        .max(MAX_PER_CALL, `json takes at most ${MAX_PER_CALL} ${what}s; split the rest over another call`)
        .safeParse(parsed);

    if (!result.success) {
        const issue = result.error.issues[0]!;
        const [index] = issue.path;
        const place = typeof index === 'number' ? `${what.charAt(0).toUpperCase()}${what.slice(1)} ${index + 1}: ` : '';

        throw new ToolRefusal('bad-json', `${place}${issue.message}`, [`example\t${example}`]);
    }

    return result.data;
}

/*
 * Runs the actions of one tool call as one write of the project file: under one lock, held to the
 * revision the call named, each action applied to what the one before it left. A refusal of any of
 * them writes nothing. A write after `run` returned, such as an undo, goes to the store as its own.
 */
export async function oneWrite<Call extends AgentCall, T>(call: Call, run: (write: Call) => Promise<T>): Promise<T> {
    const { projects } = call.host;
    const { projectId } = placeOf(call);
    let open = true;

    return projects.mutate(
        projectId,
        async (content) => {
            let current = content;
            let changed = false;
            const staged: ProjectHost = {
                locate: (id) => projects.locate(id),
                read: async (id) => (open && id === projectId ? current : projects.read(id)),
                revision: (id) => projects.revision(id),
                showView: (id, viewId, by) => projects.showView(id, viewId, by),
                machineOfNode: (nodeId) => projects.machineOfNode(nodeId),
                mutate: async (id, apply, expectedRev) => {
                    if (!open || id !== projectId) {
                        return projects.mutate(id, apply, expectedRev);
                    }

                    const mutation = await apply(current);

                    if (mutation.overlayFields !== undefined || mutation.bindMachines !== undefined || mutation.landed !== undefined) {
                        throw new Error('A write of several actions carries only content');
                    }

                    if (mutation.content !== null) {
                        current = mutation.content;
                        changed = true;
                    }

                    return mutation.result;
                }
            };

            try {
                const result = await run({ ...call, host: { ...call.host, projects: staged }, expectedRevision: undefined });

                return { content: changed ? current : null, result };
            } finally {
                open = false;
            }
        },
        call.expectedRevision
    );
}

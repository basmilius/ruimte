import { MAX_PER_CALL } from '@ruimte/actions';
import { z } from 'zod';
import { idList } from './nodes.ts';
import { VerbRefusal } from './verb.ts';

/* What every verb that changes several at once says of it, so an agent reaches for the one call and not a loop. */
export const ONE_WRITE = 'one write of the project, one update on every screen, and the call changes all of them or, refused, none';

/* The ids a verb takes in one argument, separated by commas, at most as many as one call changes. */
export function idBatch(raw: string, verb: string): string[] {
    const ids = idList(raw, verb);
    if (ids.length > MAX_PER_CALL) {
        throw new VerbRefusal('bad-arguments', `${verb} takes at most ${MAX_PER_CALL} ids at once; split the rest over another call`);
    }
    return ids;
}

/* The objects of a --json call, refused by the place in the array of the one that is wrong, never dropped. */
export function jsonBatch<Item extends z.ZodType>(json: string, item: Item, example: string): z.output<Item>[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new VerbRefusal('bad-json', '--json is not JSON; it takes an array of nodes', [`example\t${example}`]);
    }
    const result = z
        .array(item, { error: '--json needs an array of nodes' })
        .min(1, '--json needs at least one node')
        .max(MAX_PER_CALL, `--json takes at most ${MAX_PER_CALL} nodes; split the rest over another call`)
        .safeParse(parsed);
    if (!result.success) {
        const issue = result.error.issues[0]!;
        const [index] = issue.path;
        throw new VerbRefusal('bad-json', typeof index === 'number' ? `Node ${index + 1}: ${issue.message}` : issue.message, [`example\t${example}`]);
    }
    return result.data;
}

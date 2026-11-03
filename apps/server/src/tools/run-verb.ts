import type { CanvasHost, Noun, Verb } from './verb.ts';
import { CROSSING_VERBS, crossingRefused, reachedPlace, takeProjectFlag } from './reach.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { countVerb } from '../stats/usage-stats.ts';

/*
 * How long a verb may take before the server drops it, in seconds. Bun ends a request after 10 s of
 * silence, and a computer verb may hold 110 s for a card or a pause and then wait 110 s for its window.
 */
export const CANVAS_REQUEST_TIMEOUT_S = 240;

/*
 * The other project a verb asked for with `--project`, checked here so no verb parses it on its own:
 * only the verbs that cross take it, and only while the switch is on and that project is open.
 */
async function reachFor(name: string, argv: readonly string[], caller: string, project: string, host: CanvasHost, noun: boolean): Promise<IndexedPlace> {
    const action = noun && argv[0] !== undefined && !argv[0].startsWith('--') ? `${name} ${argv[0]}` : name;
    if (!CROSSING_VERBS.includes(action)) {
        throw crossingRefused(action);
    }

    return reachedPlace(host, caller, project);
}

/*
 * Runs a verb or a noun's action for the caller, with `--project` taken out and checked here so no
 * verb parses it on its own. Throws a `VerbRefusal` or a `ProjectError` for a refusal.
 */
export async function runCanvasVerb(verb: Verb | Noun, words: readonly string[], caller: string, host: CanvasHost): Promise<string[]> {
    const { project, argv } = takeProjectFlag(words);
    const reached = project === undefined ? undefined : await reachFor(verb.name, argv, caller, project, host, verb.served === 'noun');
    const lines = await verb.run(argv, reached === undefined ? { caller, host } : { caller, host, reached });
    countVerb(verb.name);

    return lines;
}

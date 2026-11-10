import { debugFrom, errorText } from './error-text.ts';

/*
 * The one door for work whose failure changes nothing: a cleanup after a failure, a kill that finds its
 * target gone, a note nobody waits for. It never rejects. What it drops is logged when RUIMTE_DEBUG is on,
 * since most of these fail every time the thing they clean up is already gone.
 */
export function bestEffort(what: string, work: PromiseLike<unknown> | undefined): Promise<void> {
    return Promise.resolve(work).then(
        () => undefined,
        (error: unknown) => {
            if (debugFrom(process.env)) {
                console.debug(`${what} failed and was dropped: ${errorText(error)}`);
            }
        }
    );
}

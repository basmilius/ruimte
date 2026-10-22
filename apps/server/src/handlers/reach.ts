import type { Dispatcher } from '../dispatcher.ts';
import type { ReachChecker } from '../pulsar/reach-check.ts';

/*
 * Whether other devices reach this machine. Any client may ask, not only the owner: the broker and the
 * door it names are in `endpoint.info` already, and the facts carry no credentials. A peer is not let in.
 */
export function registerReachHandlers(dispatcher: Dispatcher, reach: Pick<ReachChecker, 'check' | 'current'>): void {
    dispatcher.register('endpoint.reach', async (payload) => ({ reach: payload.check === true ? await reach.check() : await reach.current() }));
}

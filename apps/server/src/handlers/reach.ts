import type { Area } from '../area.ts';
import type { ReachChecker } from '../pulsar/reach-check.ts';

export interface ReachDeps {
    reach: Pick<ReachChecker, 'check' | 'current'>;
}

/*
 * Whether other devices reach this machine. Any client may ask, not only the owner: the broker and the
 * door it names are in `endpoint.info` already, and the facts carry no credentials. A peer is not let in.
 */
export function reachArea({ reach }: ReachDeps): Area {
    return {
        name: 'reach',
        handlers: (dispatcher) => {
            dispatcher.register('endpoint.reach', async (payload) => ({ reach: payload.check === true ? await reach.check() : await reach.current() }));
        }
    };
}

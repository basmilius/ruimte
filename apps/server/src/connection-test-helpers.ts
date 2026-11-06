import type { Area } from './area.ts';
import type { ConnectionHost } from './connection.ts';
import type { Dispatcher } from './dispatcher.ts';

/* A connection host for a test: the areas it brings, and no terminal screens or device pictures unless it names them. */
export function connectionHostOf(
    dispatcher: Pick<Dispatcher, 'handle'>,
    areas: readonly Area[] = [],
    rest: Partial<Omit<ConnectionHost, 'dispatcher' | 'areas'>> = {}
): ConnectionHost {
    return { dispatcher, areas, screenOf: () => false, requestKeyFrame: () => undefined, ...rest };
}

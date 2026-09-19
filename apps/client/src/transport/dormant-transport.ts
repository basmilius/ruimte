import i18next from 'i18next';
import type { PooledTransport } from './pool';
import { TransportError, type ConnectionState } from './transport';

const CLOSED: ConnectionState = { status: 'closed', attempts: 0, retryAt: null, failure: null };

/*
 * The row of "this machine" on the web client, where no daemon sits behind the page's own origin. It
 * never opens anything, so the page does not knock on its own host every few seconds, and every
 * request fails at once with a code a caller can tell apart from a machine that went away.
 */
export class DormantTransport implements PooledTransport {
    readonly status = 'closed' as const;
    readonly connection = CLOSED;

    request(): Promise<never> {
        return Promise.reject(new TransportError('no-machine', i18next.t('machines:connection.noMachine')));
    }

    on(): () => void {
        return () => undefined;
    }

    subscribeStatus(): () => void {
        return () => undefined;
    }

    switchTo(): void {}

    retarget(): void {}

    reconnect(): void {}

    dispose(): void {}
}

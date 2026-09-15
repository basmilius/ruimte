/*
 * werift's TURN client can reject a STUN transaction nobody awaits, for example when the TURN server
 * restarts under an allocation (werift issue 374), and an unhandled rejection ends the process. A relay
 * that went away costs the connections on it, never the daemon, so that one failure is logged and the
 * rest crash exactly as they would without a listener.
 */

import { errorText } from '../error-text.ts';

interface ProcessEvents {
    on(event: 'uncaughtException' | 'unhandledRejection', listener: (error: unknown) => void): unknown;
}

/*
 * A werift STUN transaction error. It carries no message; its `str` getter is the one description,
 * a string literal that survives a minified build where class names and file paths do not.
 */
export const isWeriftTransactionFailure = (error: unknown): boolean => {
    if (typeof error !== 'object' || error === null) {
        return false;
    }
    try {
        const described = (error as { str?: unknown }).str;
        if (typeof described === 'string' && described.startsWith('STUN transaction')) {
            return true;
        }
    } catch {
        // `TransactionFailed.str` reads the response it failed on, which may not be there.
    }
    return error instanceof Error && /[\\/]werift[\\/]lib[\\/]ice[\\/]/.test(error.stack ?? '');
};

export const guardWeriftTurn = (
    target: ProcessEvents,
    log: Pick<Console, 'warn' | 'error'> = console,
    exit: (code: number) => void = (code) => process.exit(code)
): void => {
    const handle = (error: unknown): void => {
        if (isWeriftTransactionFailure(error)) {
            log.warn('A direct connection lost its ICE server (TURN or STUN) and the daemon carries on:', errorText(error));
            return;
        }
        log.error(errorText(error));
        exit(1);
    };
    target.on('uncaughtException', handle);
    target.on('unhandledRejection', handle);
};

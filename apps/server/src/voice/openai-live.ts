import { CodedError } from '@adecore/agents';
import {
    isLiveSessionId,
    LiveMintError,
    mintLiveSession,
    OPENAI_API_URL,
    type LiveFetch,
    type LiveMintFailure,
    type LiveSessionAnswer,
    type LiveSessionRequest
} from '@ruimte/voice';
import { SYSTEM_CLOCK, type VoiceClock } from './clock.ts';
import { bunLiveSocket, LiveSideband, type LiveSocketOpener, type SidebandHandlers } from './sideband.ts';

/* Why a session could not start at OpenAI; the message is for a person and never holds the key or a response body. */
export class LiveError extends CodedError {}

const MINT_CODES: Record<LiveMintFailure, string> = {
    'invalid-offer': 'voice-mint-failed',
    unreachable: 'voice-mint-failed',
    cancelled: 'voice-cancelled',
    'key-rejected': 'voice-key-rejected',
    'rate-limited': 'voice-rate-limited',
    failed: 'voice-mint-failed',
    'invalid-session': 'voice-mint-failed'
};

/*
 * GPT-Live as Voice run by the daemon needs it, so a test hands in a fake and the real one stays a few
 * lines of WebSocket. `close` is for a session the daemon minted but holds no sideband to.
 */
export interface OpenAiLive {
    mint(key: string, request: LiveSessionRequest, signal: AbortSignal): Promise<LiveSessionAnswer>;
    attach(key: string, sessionId: string, handlers: SidebandHandlers, signal: AbortSignal): Promise<LiveSideband>;
    close(key: string, sessionId: string): Promise<void>;
}

interface OpenAiLiveOptions {
    fetch?: LiveFetch;
    socket?: LiveSocketOpener;
    clock?: VoiceClock;
    /* Only a test points this elsewhere, at a fake on loopback. */
    baseUrl?: string;
}

function aborted(): LiveError {
    return new LiveError('voice-cancelled', 'The Voice start was stopped');
}

export function openAiLive(options: OpenAiLiveOptions = {}): OpenAiLive {
    const fetcher: LiveFetch = options.fetch ?? ((input, init) => fetch(input, init));
    const opener = options.socket ?? bunLiveSocket;
    const clock = options.clock ?? SYSTEM_CLOCK;
    const base = options.baseUrl ?? OPENAI_API_URL;
    const socketBase = base.replace(/^http/, 'ws');

    const attach = (key: string, sessionId: string, handlers: SidebandHandlers, signal: AbortSignal): Promise<LiveSideband> => {
        if (!isLiveSessionId(sessionId)) {
            return Promise.reject(new LiveError('voice-mint-failed', 'OpenAI returned an invalid GPT-Live session'));
        }
        if (signal.aborted) {
            return Promise.reject(aborted());
        }
        const socket = opener(`${socketBase}/v1/live/sessions/${sessionId}/attach`, key);
        return new Promise((resolve, reject) => {
            let settled = false;
            let sideband: LiveSideband | null = null;
            const fail = (error: LiveError): void => {
                if (!settled) {
                    settled = true;
                    reject(error);
                }
            };
            const onAbort = (): void => {
                fail(aborted());
                socket.close(1000, 'Voice start stopped');
            };
            signal.addEventListener('abort', onAbort, { once: true });
            socket.onOpen(() => {
                if (settled) {
                    return;
                }
                settled = true;
                signal.removeEventListener('abort', onAbort);
                resolve(sideband!);
            });
            // Before open, a close is a failed attach; after it, the sideband's own handler tells the session.
            socket.onClose(() => {
                signal.removeEventListener('abort', onAbort);
                fail(new LiveError('voice-attach-failed', 'The machine could not attach to the GPT-Live session'));
            });
            sideband = new LiveSideband(socket, clock, handlers);
        });
    };

    return {
        async mint(key, request, signal) {
            try {
                return await mintLiveSession(fetcher, key, request, 'phone', { signal, baseUrl: base });
            } catch (error) {
                throw error instanceof LiveMintError ? new LiveError(MINT_CODES[error.code], error.message) : error;
            }
        },
        attach,
        /*
         * OpenAI documents no request that ends a session, only `session.close` on a socket attached to it,
         * so this attaches once more only to send that. When even that fails nobody ever gets the answer to
         * the phone's offer, so no media connects and the session lapses at OpenAI.
         */
        async close(key, sessionId) {
            const stop = new AbortController();
            const cancel = clock.after(5000, () => stop.abort());
            try {
                const sideband = await attach(key, sessionId, { event: () => undefined, lost: () => undefined }, stop.signal);
                await sideband.close();
            } catch {
                console.warn(`Voice could not close the GPT-Live session ${sessionId} it minted; it lapses at OpenAI`);
            } finally {
                cancel();
            }
        }
    };
}

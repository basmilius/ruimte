import { createSocket } from 'node:dgram';
import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';
import type { IceServer } from '@ruimte/pulsar';
import type { ReachProbe } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import {
    STUN_ATTRIBUTE,
    STUN_METHOD,
    attributeOf,
    decodeMessage,
    encodeRequest,
    errorCodeOf,
    lifetime,
    longTermKey,
    messageLength,
    newTransactionId,
    requestedTransportUdp,
    sameTransaction,
    textAttribute,
    type StunMessage
} from './stun.ts';

// A probe that has no answer by then counts as unreachable; a server on another continent answers in well under a second.
export const PROBE_TIMEOUT_MS = 3_000;

// When a UDP request goes again without an answer (RFC 8489 retransmits the same way, starting at 500 ms).
const UDP_RETRANSMIT_MS = [500, 1_000];

export interface IceTarget {
    kind: 'stun' | 'turn';
    transport: 'udp' | 'tcp' | 'tls';
    host: string;
    port: number;
    /* The URL as a person may read it, credentials left off. */
    url: string;
    username?: string;
    credential?: string;
}

/* Every URL of the servers as one target each; a URL this cannot read is left out. */
export function iceTargets(servers: readonly IceServer[]): IceTarget[] {
    return servers.flatMap((server) =>
        (Array.isArray(server.urls) ? server.urls : [server.urls]).flatMap((url) => {
            const target = parseIceUrl(url);
            if (target === null) {
                return [];
            }
            return [
                {
                    ...target,
                    ...(typeof server.username === 'string' ? { username: server.username } : {}),
                    ...(typeof server.credential === 'string' ? { credential: server.credential } : {})
                }
            ];
        })
    );
}

/* `stun:host[:port]`, `turn:host[:port][?transport=udp|tcp]` and `turns:host[:port][?transport=tcp]` (RFC 7064, RFC 7065). */
export function parseIceUrl(url: string): IceTarget | null {
    const match = /^(stuns?|turns?):(\[[^\]]+\]|[^:?\s]+)(?::(\d+))?(?:\?transport=(udp|tcp))?$/i.exec(url.trim());
    if (match === null) {
        return null;
    }
    const scheme = match[1]!.toLowerCase();
    const host = match[2]!.replace(/^\[|\]$/g, '');
    const secure = scheme.endsWith('s');
    const kind = scheme.startsWith('turn') ? 'turn' : 'stun';
    const transport = secure ? 'tls' : ((match[4]?.toLowerCase() as 'udp' | 'tcp' | undefined) ?? 'udp');
    const port = match[3] === undefined ? (secure ? 5349 : 3478) : Number(match[3]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        return null;
    }
    return { kind, transport, host, port, url: url.trim() };
}

/* One request and its answer over one transport; a probe is a short conversation over a single exchanger. */
export interface StunExchange {
    ask(request: Uint8Array, transactionId: Uint8Array): Promise<StunMessage>;
    close(): void;
}

export type OpenExchange = (target: IceTarget, timeoutMs: number) => Promise<StunExchange>;

class ProbeTimeout extends Error {
    constructor() {
        super('No answer in time');
    }
}

function udpExchange(target: IceTarget, timeoutMs: number): Promise<StunExchange> {
    const socket = createSocket(target.host.includes(':') ? 'udp6' : 'udp4');
    const waiting = new Map<string, (message: StunMessage) => void>();
    socket.on('message', (bytes) => {
        const message = decodeMessage(new Uint8Array(bytes));
        if (message !== null) {
            waiting.get(Buffer.from(message.transactionId).toString('hex'))?.(message);
        }
    });
    socket.on('error', () => undefined);
    return Promise.resolve({
        ask: (request, transactionId) =>
            new Promise<StunMessage>((resolve, reject) => {
                const key = Buffer.from(transactionId).toString('hex');
                const timers: ReturnType<typeof setTimeout>[] = [];
                const settle = (): void => {
                    waiting.delete(key);
                    timers.forEach(clearTimeout);
                };
                waiting.set(key, (message) => {
                    settle();
                    resolve(message);
                });
                // A send that fails is a probe without an answer, which the timeout already says.
                const send = (): void => socket.send(request, target.port, target.host, () => undefined);
                send();
                for (const delay of UDP_RETRANSMIT_MS) {
                    timers.push(setTimeout(send, delay));
                }
                timers.push(
                    setTimeout(() => {
                        settle();
                        reject(new ProbeTimeout());
                    }, timeoutMs)
                );
            }),
        close: () => {
            try {
                socket.close();
            } catch {
                // Closed already.
            }
        }
    });
}

function streamExchange(target: IceTarget, timeoutMs: number): Promise<StunExchange> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new ProbeTimeout());
        }, timeoutMs);
        const opened = (): void => {
            clearTimeout(timer);
            resolve(exchangeOver(socket, timeoutMs));
        };
        const socket: Socket =
            target.transport === 'tls'
                ? connectTls({ host: target.host, port: target.port, servername: target.host }, opened)
                : connectTcp({ host: target.host, port: target.port }, opened);
        socket.once('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

/* STUN over a stream comes as whole messages back to back (RFC 8489, 6.2.2), so a message is cut by its own length. */
function exchangeOver(socket: Socket, timeoutMs: number): StunExchange {
    let buffered = new Uint8Array(0);
    const waiting = new Map<string, (message: StunMessage) => void>();
    socket.on('data', (chunk: Buffer) => {
        const next = new Uint8Array(buffered.length + chunk.length);
        next.set(buffered);
        next.set(chunk, buffered.length);
        buffered = next;
        for (let length = messageLength(buffered); length !== null && buffered.length >= length; length = messageLength(buffered)) {
            const message = decodeMessage(buffered.slice(0, length));
            buffered = buffered.slice(length);
            if (message !== null) {
                waiting.get(Buffer.from(message.transactionId).toString('hex'))?.(message);
            }
        }
    });
    socket.on('error', () => undefined);
    return {
        ask: (request, transactionId) =>
            new Promise<StunMessage>((resolve, reject) => {
                const key = Buffer.from(transactionId).toString('hex');
                const timer = setTimeout(() => {
                    waiting.delete(key);
                    reject(new ProbeTimeout());
                }, timeoutMs);
                waiting.set(key, (message) => {
                    clearTimeout(timer);
                    waiting.delete(key);
                    resolve(message);
                });
                socket.write(request);
            }),
        close: () => socket.destroy()
    };
}

export const openExchange: OpenExchange = (target, timeoutMs) =>
    target.transport === 'udp' ? udpExchange(target, timeoutMs) : streamExchange(target, timeoutMs);

async function ask(exchange: StunExchange, method: number, attributes: Parameters<typeof encodeRequest>[2], key?: Uint8Array): Promise<StunMessage> {
    const transactionId = newTransactionId();
    const answer = await exchange.ask(encodeRequest(method, transactionId, attributes, key), transactionId);
    if (!sameTransaction(answer.transactionId, transactionId)) {
        throw new Error('The answer belongs to another request');
    }
    return answer;
}

function textOf(value: Uint8Array | null): string | null {
    return value === null ? null : new TextDecoder().decode(value);
}

type Outcome = Pick<ReachProbe, 'outcome' | 'error'>;

async function bind(exchange: StunExchange): Promise<Outcome> {
    const answer = await ask(exchange, STUN_METHOD.binding, []);
    return answer.kind === 'success' ? { outcome: 'ok' } : { outcome: 'refused', error: `Binding answered ${errorCodeOf(answer)}` };
}

/*
 * An allocation the way a TURN client opens one: unsigned first for the realm and nonce, then signed with
 * the long-term key, once more on a stale nonce. A relay it got is released at once, so a check holds
 * nothing on the server.
 */
async function allocate(exchange: StunExchange, target: IceTarget): Promise<Outcome> {
    let answer = await ask(exchange, STUN_METHOD.allocate, [requestedTransportUdp()]);
    if (answer.kind === 'success') {
        await ask(exchange, STUN_METHOD.refresh, [lifetime(0)]).catch(() => undefined);
        return { outcome: 'ok' };
    }
    if (errorCodeOf(answer) !== 401) {
        return { outcome: 'refused', error: `Allocate answered ${errorCodeOf(answer)}` };
    }
    if (target.username === undefined || target.credential === undefined) {
        return { outcome: 'refused', error: 'The server wants credentials the broker did not give' };
    }
    const realm = textOf(attributeOf(answer, STUN_ATTRIBUTE.realm)) ?? '';
    const key = longTermKey(target.username, realm, target.credential);
    for (let attempt = 0; attempt < 2; attempt++) {
        const nonce = textOf(attributeOf(answer, STUN_ATTRIBUTE.nonce)) ?? '';
        const signed = [
            requestedTransportUdp(),
            textAttribute(STUN_ATTRIBUTE.username, target.username),
            textAttribute(STUN_ATTRIBUTE.realm, realm),
            textAttribute(STUN_ATTRIBUTE.nonce, nonce)
        ];
        answer = await ask(exchange, STUN_METHOD.allocate, signed, key);
        if (answer.kind === 'success') {
            const release = [
                lifetime(0),
                textAttribute(STUN_ATTRIBUTE.username, target.username),
                textAttribute(STUN_ATTRIBUTE.realm, realm),
                textAttribute(STUN_ATTRIBUTE.nonce, nonce)
            ];
            await ask(exchange, STUN_METHOD.refresh, release, key).catch(() => undefined);
            return { outcome: 'ok' };
        }
        // 438 is a stale nonce, which comes with a fresh one.
        if (errorCodeOf(answer) !== 438) {
            break;
        }
    }
    return { outcome: 'refused', error: `Allocate answered ${errorCodeOf(answer)}` };
}

/* Asks one server what it is for: a binding of a STUN server, an allocation of a TURN server. */
export async function probeTarget(target: IceTarget, open: OpenExchange = openExchange, timeoutMs = PROBE_TIMEOUT_MS): Promise<ReachProbe> {
    const described = { kind: target.kind, url: target.url, transport: target.transport };
    let exchange: StunExchange | null = null;
    try {
        exchange = await open(target, timeoutMs);
        const outcome = target.kind === 'stun' ? await bind(exchange) : await allocate(exchange, target);
        return { ...described, ...outcome };
    } catch (e) {
        return { ...described, outcome: 'unreachable', error: e instanceof ProbeTimeout ? e.message : errorText(e) };
    } finally {
        exchange?.close();
    }
}

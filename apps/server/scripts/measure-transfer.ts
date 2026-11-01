import { parseArgs } from 'node:util';
import { BinaryFrameAssembler, FrameAssembler, isBinaryPiece, splitFrame } from '@ruimte/contracts';
import { RTCPeerConnection, type RTCDataChannel } from 'werift';
import { directChannel, fromWerift, type DirectChannel } from '../src/pulsar/data-channel.ts';

/*
 * How long a small frame takes there and back while a file moves over the same direct connection, with the
 * file on the channel of the small frames or on a second one, over a link with a delay, a rate and loss.
 *
 *   bun --conditions=source apps/server/scripts/measure-transfer.ts --mib 16 > transfer.md
 *
 * The daemon's side is the real `directChannel` in a process of its own, and between the two ends a UDP relay
 * shapes the real ICE, DTLS and SCTP. The client's side is werift, not a browser's or iOS's SCTP.
 */

const PIECE_BYTES = 256 * 1024;
const UPLOAD_PIECE_BYTES = 64 * 1024;
const PIECES_IN_FLIGHT = 2;
const PROBE_EVERY_MS = 50;
const IDLE_PROBES = 20;
const RUN_LIMIT_MS = 60_000;
const FRAME_PIECE_CHARS = 16_000;

type Mode = 'down-one' | 'down-two' | 'up-one' | 'up-two';
type Link = { name: string; delayMs: number; bitsPerSecond: number; loss: number };
type DaemonMessage = { kind: 'answer'; sdp: string };
type ClientMessage = { kind: 'offer'; sdp: string };

const MODES: Mode[] = ['down-one', 'down-two', 'up-one', 'up-two'];
const LINKS: Link[] = [
    { name: 'loopback', delayMs: 0, bitsPerSecond: 0, loss: 0 },
    { name: '40 ms, 20 Mbit/s', delayMs: 20, bitsPerSecond: 20_000_000, loss: 0 },
    { name: '40 ms, 20 Mbit/s, 1% loss', delayMs: 20, bitsPerSecond: 20_000_000, loss: 0.01 }
];

function gathered(peer: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
        if (peer.iceGatheringState === 'complete') {
            resolve();

            return;
        }

        const subscription = peer.iceGatheringStateChange.subscribe((state) => {
            if (state === 'complete') {
                subscription.unSubscribe();
                resolve();
            }
        });
    });
}

/* The daemon's end: answers a probe at once, a request with a piece and an uploaded piece with its acknowledgement, as `fs.writePiece` is. */
async function daemon(): Promise<void> {
    const peer = new RTCPeerConnection({});
    const channels = new Map<string, DirectChannel>();

    peer.onDataChannel.subscribe((opened) => {
        const channel = directChannel(fromWerift(opened));

        channels.set(opened.label, channel);
        channel.receiveWith((frame) => {
            if (frame.startsWith('ping')) {
                channel.send(`pong${frame.slice(4)}`);
            } else if (frame.startsWith('get:')) {
                channel.send(new Uint8Array(Number(frame.slice(4))));
            } else if (frame.startsWith('put:')) {
                channel.send('ack');
            }
        }, Number.MAX_SAFE_INTEGER);
    });

    process.on('message', (message: ClientMessage) => {
        void (async () => {
            await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp });
            await peer.setLocalDescription(await peer.createAnswer());
            await gathered(peer);
            process.send?.({ kind: 'answer', sdp: peer.localDescription!.sdp } satisfies DaemonMessage);
        })();
    });
}

interface Shaper {
    readonly port: number;
    forward(data: Buffer): void;
    aim(address: string, port: number): void;
}

/* One direction of the link: what arrives goes out at the link's rate after its delay, past a queue of a quarter of a second. */
function shaped(link: Link, send: (data: Buffer) => void): (data: Buffer) => void {
    let free = 0;

    return (data) => {
        if (Math.random() < link.loss) {
            return;
        }

        const now = performance.now();
        const wire = link.bitsPerSecond === 0 ? 0 : (data.byteLength * 8 * 1000) / link.bitsPerSecond;

        if (free - now > 250) {
            return;
        }

        free = Math.max(free, now) + wire;
        const wait = free - now + link.delayMs;

        if (wait < 1) {
            send(data);
        } else {
            setTimeout(() => send(data), wait);
        }
    };
}

async function relayEnd(onData: (data: Buffer) => void): Promise<Shaper & { socket: { send(data: Buffer, port: number, address: string): void } }> {
    let target: { address: string; port: number } | null = null;
    const socket = await Bun.udpSocket({
        socket: {
            data: (_socket, data) => onData(data)
        }
    });

    return {
        port: socket.port,
        socket,
        forward: (data) => {
            if (target !== null) {
                socket.send(data, target.port, target.address);
            }
        },
        aim: (address, port) => {
            target = { address, port };
        }
    };
}

/* The description with the one host candidate that goes through the relay, and the address behind it. */
function throughRelay(sdp: string, port: number): { sdp: string; address: string; port: number } {
    const candidates = sdp.split('\r\n').filter((line) => line.startsWith('a=candidate:'));
    const host = candidates.map((line) => /^(a=candidate:\S+ \d+ udp \d+ )(\d+\.\d+\.\d+\.\d+) (\d+)( typ host.*)$/i.exec(line)).find((match) => match !== null);

    if (!host) {
        throw new Error('No IPv4 host candidate to send through the relay');
    }

    const line = `${host[1]}${host[2]} ${port}${host[4]}`;
    const others = new Set(candidates.filter((candidate) => candidate !== host[0]));
    const lines = sdp
        .split('\r\n')
        .filter((each) => !others.has(each))
        .map((each) => (each === host[0] ? line : each));

    return { sdp: lines.join('\r\n'), address: host[2]!, port: Number(host[3]) };
}

function percentile(sorted: number[], share: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? Number.NaN;
}

function opened(channel: RTCDataChannel): Promise<void> {
    return new Promise((resolve) => {
        if (channel.readyState === 'open') {
            resolve();

            return;
        }

        const subscription = channel.stateChanged.subscribe((state) => {
            if (state === 'open') {
                subscription.unSubscribe();
                resolve();
            }
        });
    });
}

interface Result {
    link: string;
    mode: Mode;
    idle: number;
    p50: number;
    p95: number;
    max: number;
    seconds: number | null;
}

async function run(link: Link, mode: Mode, bytes: number): Promise<Result> {
    const child = Bun.spawn([process.execPath, '--conditions=source', import.meta.path, 'daemon'], {
        stdio: ['ignore', 'ignore', 'inherit'],
        serialization: 'json',
        ipc: (message: DaemonMessage) => answered(message)
    });
    let answered: (message: DaemonMessage) => void = () => undefined;
    const answer = new Promise<DaemonMessage>((resolve) => {
        answered = resolve;
    });
    const peer = new RTCPeerConnection({});
    const towardDaemon: { current: (data: Buffer) => void } = { current: () => undefined };
    const towardClient: { current: (data: Buffer) => void } = { current: () => undefined };
    // The client talks to `seenByClient`, the daemon to `seenByDaemon`; each sends on from the other's socket, so a peer sees one address.
    const seenByClient = await relayEnd((data) => towardDaemon.current(data));
    const seenByDaemon = await relayEnd((data) => towardClient.current(data));

    towardDaemon.current = shaped(link, (data) => seenByDaemon.forward(data));
    towardClient.current = shaped(link, (data) => seenByClient.forward(data));

    const two = mode.endsWith('-two');
    const probe = peer.createDataChannel('probe', { ordered: true });
    const transfer = two ? peer.createDataChannel('transfer', { ordered: true }) : probe;

    await peer.setLocalDescription(await peer.createOffer());
    await gathered(peer);

    const offer = throughRelay(peer.localDescription!.sdp, seenByDaemon.port);

    seenByClient.aim(offer.address, offer.port);
    child.send({ kind: 'offer', sdp: offer.sdp } satisfies ClientMessage);

    const reply = throughRelay((await answer).sdp, seenByClient.port);

    seenByDaemon.aim(reply.address, reply.port);
    await peer.setRemoteDescription({ type: 'answer', sdp: reply.sdp });
    await Promise.all([opened(probe), opened(transfer)]);

    const sentAt = new Map<number, number>();
    const trips: number[] = [];
    const idleTrips: number[] = [];
    let measuring = false;
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
        finish = resolve;
    });
    let received = 0;
    let requested = 0;
    const started = { at: 0 };
    let inFlight = 0;
    let uploadedBytes = 0;
    let sendUpload: () => void = () => undefined;

    const askMore = (): void => {
        while (requested < bytes && requested - received < PIECES_IN_FLIGHT * PIECE_BYTES) {
            const length = Math.min(PIECE_BYTES, bytes - requested);

            requested += length;
            sendText(transfer, `get:${length}`);
        }
    };

    const listen = (channel: RTCDataChannel): void => {
        const text = new FrameAssembler();
        const binary = new BinaryFrameAssembler();

        channel.onMessage.subscribe((data) => {
            const piece = typeof data === 'string' ? data : new Uint8Array(data);

            if (piece instanceof Uint8Array && isBinaryPiece(piece)) {
                const result = binary.push(piece, Number.MAX_SAFE_INTEGER);

                if (result.kind === 'frame') {
                    received += result.frame.byteLength;
                    askMore();

                    if (received >= bytes) {
                        finish();
                    }
                }

                return;
            }

            const result = text.push(typeof piece === 'string' ? piece : new TextDecoder().decode(piece), Number.MAX_SAFE_INTEGER);

            if (result.kind !== 'frame') {
                return;
            }

            if (result.frame.startsWith('pong')) {
                const id = Number(result.frame.slice(5));
                const trip = performance.now() - (sentAt.get(id) ?? 0);

                sentAt.delete(id);
                (measuring ? trips : idleTrips).push(trip);
            } else if (result.frame === 'ack') {
                inFlight -= 1;
                uploadedBytes += UPLOAD_PIECE_BYTES;

                if (uploadedBytes >= bytes) {
                    finish();
                } else {
                    sendUpload();
                }
            }
        });
    };

    listen(probe);

    if (two) {
        listen(transfer);
    }

    let id = 0;
    const probing = setInterval(() => {
        id += 1;
        sentAt.set(id, performance.now());
        sendText(probe, `ping:${id}`);
    }, PROBE_EVERY_MS);

    while (idleTrips.length < IDLE_PROBES) {
        await Bun.sleep(PROBE_EVERY_MS);
    }

    measuring = true;
    started.at = performance.now();

    if (mode.startsWith('down')) {
        askMore();
    } else {
        const piece = `put:${Buffer.alloc(UPLOAD_PIECE_BYTES).toString('base64')}`;

        sendUpload = (): void => {
            while (uploadedBytes + inFlight * UPLOAD_PIECE_BYTES < bytes && inFlight < PIECES_IN_FLIGHT) {
                inFlight += 1;
                sendText(transfer, piece);
            }
        };
        sendUpload();
    }

    const limit = Bun.sleep(RUN_LIMIT_MS).then(() => 'limit' as const);
    const outcome = await Promise.race([finished.then(() => 'done' as const), limit]);
    const seconds = outcome === 'done' ? (performance.now() - started.at) / 1000 : null;

    clearInterval(probing);

    // A probe the transfer held past its end still counts, for as long as it has been waiting.
    for (const sent of sentAt.values()) {
        if (sent >= started.at) {
            trips.push(performance.now() - sent);
        }
    }

    await peer.close();
    child.kill();

    const sorted = trips.toSorted((first, second) => first - second);
    const idleSorted = idleTrips.toSorted((first, second) => first - second);

    return {
        link: link.name,
        mode,
        idle: percentile(idleSorted, 0.5),
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted.at(-1) ?? Number.NaN,
        seconds
    };
}

function sendText(channel: RTCDataChannel, frame: string): void {
    for (const piece of splitFrame(frame, FRAME_PIECE_CHARS)) {
        channel.send(piece);
    }
}

async function measure(): Promise<void> {
    const { values } = parseArgs({ options: { mib: { type: 'string', default: '16' }, repeats: { type: 'string', default: '1' }, link: { type: 'string', default: '' } } });
    const bytes = Number(values.mib) * 1024 * 1024;
    const results: Result[] = [];

    for (const link of LINKS.filter((each) => each.name.includes(values.link))) {
        for (const mode of MODES) {
            for (let i = 0; i < Number(values.repeats); i++) {
                const result = await run(link, mode, bytes);

                results.push(result);
                console.error(JSON.stringify(result));
            }
        }
    }

    const round = (value: number): string => (Number.isNaN(value) ? '-' : String(Math.round(value)));

    console.log(`${values.mib} MiB per run, a probe every ${PROBE_EVERY_MS} ms; round trips in ms.\n`);
    console.log('| Link | File | Idle | p50 | p95 | Max | Seconds |');
    console.log('|---|---|---:|---:|---:|---:|---:|');

    for (const row of results) {
        console.log(`| ${row.link} | ${row.mode} | ${round(row.idle)} | ${round(row.p50)} | ${round(row.p95)} | ${round(row.max)} | ${row.seconds?.toFixed(1) ?? 'over limit'} |`);
    }

    process.exit(0);
}

await (process.argv[2] === 'daemon' ? daemon() : measure());

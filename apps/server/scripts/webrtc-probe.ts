/*
 * Does a DataChannel come up between two machines on different networks, and does it stay up?
 * werift on both ends, so it tests the half the daemon runs, with nothing but a STUN server and the
 * two terminals between them. The signaling is copy and paste: there is no broker yet.
 *
 *   machine A (the daemon's side):  bun apps/server/scripts/webrtc-probe.ts answer
 *   machine B (the client's side):  bun apps/server/scripts/webrtc-probe.ts offer
 *
 * B prints an offer line; paste it into A. A prints an answer line; paste it into B. From then on B
 * sends a ping every second and a burst every minute, and both sides print a line every ten seconds
 * until `--minutes` is up (default 60) or the connection drops.
 *
 * Flags: --stun <url> (repeatable, default stun:stun.l.google.com:19302), --no-stun, --minutes <n>,
 * --burst-mb <n> (default 4), --ports <first-last> (the UDP range to bind, for a firewall).
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { RTCPeerConnection, type RTCDataChannel } from 'werift';
import { parsePortRange } from '../src/config.ts';

const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
        stun: { type: 'string', multiple: true, default: [] },
        'no-stun': { type: 'boolean', default: false },
        minutes: { type: 'string', default: '60' },
        'burst-mb': { type: 'string', default: '4' },
        ports: { type: 'string' }
    },
    allowPositionals: true
});

const role = positionals[0];
if (role !== 'offer' && role !== 'answer') {
    console.error('Usage: bun apps/server/scripts/webrtc-probe.ts offer|answer [--stun url] [--no-stun] [--minutes n] [--burst-mb n] [--ports a-b]');
    process.exit(2);
}

const stun = values['no-stun'] ? [] : values.stun.length > 0 ? values.stun : ['stun:stun.l.google.com:19302'];
const minutes = Number(values.minutes);
const burstBytes = Number(values['burst-mb']) * 1024 * 1024;
const PIECE = 16_000;

const started = Date.now();
const stamp = (): string => `[${((Date.now() - started) / 1000).toFixed(1).padStart(7)}s]`;
const log = (line: string): void => console.log(`${stamp()} ${line}`);

const encode = (sdp: string): string => Buffer.from(JSON.stringify({ sdp })).toString('base64url');
const decode = (line: string): string => (JSON.parse(Buffer.from(line.trim(), 'base64url').toString()) as { sdp: string }).sdp;

const lines = createInterface({ input: process.stdin });
const nextLine = (prompt: string): Promise<string> =>
    new Promise((resolve) => {
        console.log(prompt);
        lines.once('line', resolve);
    });

const peer = new RTCPeerConnection({
    iceServers: stun.map((urls) => ({ urls })),
    icePortRange: values.ports ? parsePortRange(values.ports) : undefined
});

const gathered = async (): Promise<void> => {
    const deadline = Date.now() + 8_000;
    while (peer.iceGatheringState !== 'complete' && Date.now() < deadline) {
        await Bun.sleep(50);
    }
};

const candidateTypes = (sdp: string): string => {
    const types = [...sdp.matchAll(/typ (\w+)/g)].map((match) => match[1]);
    return types.length === 0 ? 'none' : [...new Set(types)].join(', ');
};

peer.iceConnectionStateChange.subscribe((state) => log(`ice ${state}`));
peer.connectionStateChange.subscribe((state) => {
    log(`connection ${state}`);
    if (state === 'failed' || state === 'closed') {
        finish(1);
    }
});

let channel: RTCDataChannel | null = null;
let received = 0;
let pings = 0;
let pongs = 0;
const rtts: number[] = [];
let burstStarted = 0;
let burstExpected = 0;

const onChannel = (opened: RTCDataChannel): void => {
    channel = opened;
    opened.stateChanged.subscribe((state) => {
        log(`channel ${state}`);
        if (state === 'open') {
            const pair = peer.iceTransports[0]?.connection.nominated;
            log(`open after ${Date.now() - started} ms over ${pair ? `${pair.localCandidate.type} -> ${pair.remoteCandidate.type} ${pair.remoteAddr.join(':')}` : 'an unknown pair'}`);
            if (role === 'offer') {
                startClient(opened);
            }
        }
        if (state === 'closed') {
            finish(1);
        }
    });
    opened.onMessage.subscribe((data) => {
        const text = typeof data === 'string' ? data : data.toString();
        received += text.length;
        if (text.startsWith('ping ')) {
            opened.send(`pong ${text.slice(5)}`);
            return;
        }
        if (text.startsWith('pong ')) {
            pongs += 1;
            rtts.push(Date.now() - Number(text.slice(5)));
            return;
        }
        if (text === 'burst-done') {
            opened.send(`burst-ack ${received}`);
            return;
        }
        if (text.startsWith('burst-ack ')) {
            const seconds = (Date.now() - burstStarted) / 1000;
            log(`burst of ${(burstExpected / 1024 / 1024).toFixed(1)} MB delivered in ${seconds.toFixed(2)} s, ${(burstExpected / 1024 / 1024 / seconds).toFixed(2)} MB/s`);
        }
    });
};

const burst = (opened: RTCDataChannel): void => {
    const piece = 'b'.repeat(PIECE);
    burstStarted = Date.now();
    burstExpected = Math.ceil(burstBytes / PIECE) * PIECE;
    for (let sent = 0; sent < burstBytes; sent += PIECE) {
        opened.send(piece);
    }
    opened.send('burst-done');
};

const startClient = (opened: RTCDataChannel): void => {
    setInterval(() => {
        if (opened.readyState === 'open') {
            pings += 1;
            opened.send(`ping ${Date.now()}`);
        }
    }, 1_000);
    burst(opened);
    setInterval(() => burst(opened), 60_000);
};

setInterval(() => {
    const recent = rtts.splice(0);
    const average = recent.length === 0 ? null : Math.round(recent.reduce((sum, rtt) => sum + rtt, 0) / recent.length);
    const worst = recent.length === 0 ? null : Math.max(...recent);
    log(
        `${peer.connectionState}, channel ${channel?.readyState ?? 'none'}, buffered ${channel?.bufferedAmount ?? 0}` +
            (role === 'offer' ? `, pings ${pings} pongs ${pongs}, rtt avg ${average ?? '-'} ms max ${worst ?? '-'} ms` : `, received ${received}`)
    );
}, 10_000);

setTimeout(() => {
    log(`stayed up for ${minutes} minutes`);
    finish(0);
}, minutes * 60_000);

let finished = false;
const finish = (code: number): void => {
    if (finished) {
        return;
    }
    finished = true;
    log(code === 0 ? 'done' : 'the connection is gone');
    void peer.close().finally(() => process.exit(code));
};

log(`probe as ${role}, STUN ${stun.length === 0 ? 'off' : stun.join(' ')}`);
if (role === 'offer') {
    onChannel(peer.createDataChannel('probe', { ordered: true }));
    await peer.setLocalDescription(await peer.createOffer());
    await gathered();
    const offer = peer.localDescription!.sdp;
    log(`candidates: ${candidateTypes(offer)}`);
    console.log(`\nPaste this line into the other machine:\n\n${encode(offer)}\n`);
    const answer = decode(await nextLine('Then paste the answer line here:'));
    log(`their candidates: ${candidateTypes(answer)}`);
    await peer.setRemoteDescription({ type: 'answer', sdp: answer });
} else {
    peer.onDataChannel.subscribe(onChannel);
    const offer = decode(await nextLine('Paste the offer line from the other machine:'));
    log(`their candidates: ${candidateTypes(offer)}`);
    await peer.setRemoteDescription({ type: 'offer', sdp: offer });
    await peer.setLocalDescription(await peer.createAnswer());
    await gathered();
    const answer = peer.localDescription!.sdp;
    log(`candidates: ${candidateTypes(answer)}`);
    console.log(`\nPaste this line into the other machine:\n\n${encode(answer)}\n`);
}

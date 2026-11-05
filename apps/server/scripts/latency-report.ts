/*
 * The report of `measure-latency.ts`: percentiles of what a client waited for, laid out as the
 * Markdown that goes in a decision on per-session quotas. Pure, so the layout
 * is tested without a daemon, a clock or a machine.
 */

export type Channel = 'socket' | 'direct';

interface Percentiles {
    n: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
}

/* What one phase (idle, then under load) of one channel collected. Latencies are milliseconds. */
export interface PhaseData {
    seconds: number;
    /* `server.ping` round trips. */
    reply: number[];
    /* Keys typed into a quiet terminal until their echo came back. */
    quiet: number[];
    /* `chat.send` until the first chat event of its turn. */
    chat: number[];
    /* The daemon's event loop running late, sampled in its own process. */
    lag: number[];
    /* Output of the busy terminal as the client received it. */
    busyBytes: number;
    busyFrames: number;
    /* Screens the daemon had to send again because the client fell behind. */
    resyncs: number;
    /* Sends the channel answered with backpressure or a drop, where the output gate stops streaming. */
    pauses: number;
}

export interface ChannelRun {
    channel: Channel;
    idle: PhaseData;
    busy: PhaseData;
}

export interface Fixture {
    busyCommand: string;
    replyIntervalMs: number;
    quietIntervalMs: number;
    chatIntervalMs: number;
    warmupSeconds: number;
    seconds: number;
    channels: Channel[];
}

export interface Run {
    fixture: Fixture;
    channels: ChannelRun[];
}

/* Where and on what it ran, gathered by the script and handed over as plain text. */
export interface Environment {
    date: string;
    commit: string;
    dirty: boolean;
    bun: string;
    version: string;
    build: string | null;
    protocol: number;
    agents: string;
    cpu: string;
    cores: number;
    memoryGiB: number;
    os: string;
    model: string | null;
    power: string | null;
}

const EMPTY: Percentiles = { n: 0, p50: 0, p95: 0, p99: 0, max: 0 };

/* Nearest rank: the smallest sample that at least p percent of the samples are not above. */
export function percentiles(samples: readonly number[]): Percentiles {
    if (samples.length === 0) {
        return EMPTY;
    }
    const sorted = samples.toSorted((left, right) => left - right);
    const at = (percent: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1))]!;
    return { n: sorted.length, p50: at(50), p95: at(95), p99: at(99), max: sorted[sorted.length - 1]! };
}

function ms(value: number): string {
    return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function row(label: readonly string[], samples: readonly number[]): string {
    const found = percentiles(samples);
    return `| ${label.join(' | ')} | ${found.n} | ${ms(found.p50)} | ${ms(found.p95)} | ${ms(found.p99)} | ${ms(found.max)} |`;
}

const METRICS: ReadonlyArray<{ title: string; pick(phase: PhaseData): readonly number[] }> = [
    { title: 'Reply (server.ping)', pick: (phase) => phase.reply },
    { title: 'Quiet session echo', pick: (phase) => phase.quiet },
    { title: 'Chat first event', pick: (phase) => phase.chat },
    { title: 'Daemon event-loop lag', pick: (phase) => phase.lag }
];

function environmentLines(env: Environment): string[] {
    return [
        `- Date: ${env.date}`,
        `- Commit: ${env.commit}${env.dirty ? ' (uncommitted changes)' : ''}`,
        `- Bun ${env.bun}, Ruimte ${env.version}${env.build === null ? '' : ` (build ${env.build})`}, protocol ${env.protocol}, @adecore/agents ${env.agents}`,
        `- CPU: ${env.cpu}, ${env.cores} cores, ${env.memoryGiB} GiB`,
        `- OS: ${env.os}${env.model === null ? '' : `, ${env.model}`}`,
        `- Power: ${env.power ?? 'unknown'}`
    ];
}

function fixtureLines(fixture: Fixture): string[] {
    return [
        `- Channels: ${fixture.channels.join(', ')}`,
        `- Busy terminal: \`${fixture.busyCommand}\``,
        `- Quiet terminal: \`cat\`, one key line every ${fixture.quietIntervalMs} ms`,
        `- Reply probe: \`server.ping\` every ${fixture.replyIntervalMs} ms`,
        `- Chat probe: \`chat.send\` on the in-process fake Claude every ${fixture.chatIntervalMs} ms`,
        `- Phases: ${fixture.warmupSeconds} s warm-up (discarded), ${fixture.seconds} s idle, ${fixture.seconds} s with the busy terminal running`
    ];
}

export function renderReport(run: Run, env: Environment): string {
    const lines: string[] = [
        '# Latency under load',
        '',
        '## Environment',
        '',
        ...environmentLines(env),
        '',
        '## Fixture',
        '',
        ...fixtureLines(run.fixture),
        ''
    ];
    lines.push(
        '## What this measures',
        '',
        "The daemon side of the channel: the output gate, framing and the socket or SCTP buffers. The client here is Bun (and werift for the direct channel, a JavaScript SCTP stack that can be the bottleneck itself), so it says nothing about Chromium's WebRTC stack or a real network path.",
        '',
        '## Results',
        '',
        'Milliseconds.',
        '',
        '| Channel | Phase | Metric | n | p50 | p95 | p99 | max |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |'
    );
    for (const channel of run.channels) {
        for (const phase of ['idle', 'busy'] as const) {
            for (const metric of METRICS) {
                lines.push(row([channel.channel, phase === 'idle' ? 'idle' : 'busy terminal', metric.title], metric.pick(channel[phase])));
            }
        }
    }
    lines.push('', '### The busy terminal', '', '| Channel | Output MB/s | Frames/s | Resyncs | Gate pauses |', '| --- | ---: | ---: | ---: | ---: |');
    for (const channel of run.channels) {
        const { busy } = channel;
        const seconds = Math.max(busy.seconds, 1e-9);
        lines.push(
            `| ${channel.channel} | ${(busy.busyBytes / 1024 / 1024 / seconds).toFixed(2)} | ${(busy.busyFrames / seconds).toFixed(0)} | ${busy.resyncs} | ${busy.pauses} |`
        );
    }
    lines.push(
        '',
        '## Conclusion',
        '',
        'Per-session output quota: yes or no, and at what threshold?',
        '',
        '_To be filled in by the person who reads the numbers._',
        ''
    );
    return lines.join('\n');
}

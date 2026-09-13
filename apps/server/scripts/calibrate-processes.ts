import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { ChatListResult, ProcessesAlerts, ProcessesSampleEvent, SessionListResult } from '@ruimte/contracts';

/*
 * Logs what the stuck warnings are judged on, so their thresholds can be calibrated on real sessions:
 * every sample of Ruimte's own tree next to the hook status of every terminal and the status of every
 * chat, one JSON line per sample. It asks a running daemon over its socket (a loopback client needs no
 * credential) and keeps the panel's tempo of two seconds for as long as it runs.
 *
 *   bun scripts/calibrate-processes.ts                          an hour against the daemon on 4210
 *   bun scripts/calibrate-processes.ts --port 4211 --minutes 20
 *
 * The file lands in `$RUIMTE_HOME/processes/` (`--home` for another one).
 */
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        port: { type: 'string', default: '4210' },
        minutes: { type: 'string', default: '60' },
        home: { type: 'string', default: process.env.RUIMTE_HOME ?? join(homedir(), '.ruimte') }
    },
    strict: true
});

const folder = join(values.home, 'processes');
await mkdir(folder, { recursive: true });
const file = join(folder, `calibration-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

const socket = new WebSocket(`ws://127.0.0.1:${values.port}/ws`);
const pending = new Map<string, (result: unknown) => void>();
let alerts: ProcessesAlerts['alerts'] = [];
let lines = 0;

const request = <T>(type: string, payload: unknown): Promise<T> =>
    new Promise((resolve) => {
        const id = crypto.randomUUID();
        pending.set(id, (result) => resolve(result as T));
        socket.send(JSON.stringify({ id, type, payload }));
    });

const record = async (sample: ProcessesSampleEvent): Promise<void> => {
    const [sessions, chats] = await Promise.all([request<SessionListResult>('session.list', {}), request<ChatListResult>('chat.list', {})]);
    const line = {
        at: sample.at,
        machine: sample.machine,
        groups: sample.groups.map((group) => ({
            id: group.id,
            cpu: group.cpu,
            memory: group.memory,
            disk: group.diskRead === null && group.diskWrite === null ? null : (group.diskRead ?? 0) + (group.diskWrite ?? 0),
            processes: group.processes.map((row) => ({ pid: row.pid, name: row.name, family: row.family, cpu: row.cpu, memory: row.memory }))
        })),
        terminals: sessions.sessions.map((session) => ({ id: session.sessionId, exited: session.exited, agent: session.agent })),
        chats: chats.chats.map((chat) => ({ id: chat.chatId, provider: chat.provider, status: chat.status })),
        alerts
    };
    await appendFile(file, `${JSON.stringify(line)}\n`);
    lines++;
};

socket.onmessage = (message) => {
    const frame = JSON.parse(String(message.data)) as { id?: string; ok?: boolean; result?: unknown; event?: string; payload?: unknown };
    if (frame.id !== undefined && pending.has(frame.id)) {
        pending.get(frame.id)!(frame.result);
        pending.delete(frame.id);
    } else if (frame.event === 'processes.sample') {
        void record(frame.payload as ProcessesSampleEvent);
    } else if (frame.event === 'processes.alerts') {
        alerts = (frame.payload as ProcessesAlerts).alerts;
    }
};
socket.onclose = () => {
    console.log(`The socket closed after ${lines} samples; ${file}`);
    process.exit(0);
};

await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`Nothing answers on port ${values.port}`));
});
alerts = (await request<ProcessesAlerts>('processes.listAlerts', {})).alerts;
await request('processes.subscribe', { scope: 'ruimte', sort: 'cpu' });
console.log(`Logging to ${file} for ${values.minutes} minutes`);
setTimeout(
    () => {
        socket.close();
    },
    Number(values.minutes) * 60_000
);

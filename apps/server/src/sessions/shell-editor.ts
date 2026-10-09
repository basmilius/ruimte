import { chmodSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Socket } from 'bun';
import { ShellPrompt, type ShellEditorConnection, type ShellEditorState, type ShellPrepareOutcome } from './shell-prompt';

interface Peer {
    buffer: string;
    authorized: boolean;
    decoder: TextDecoder;
    disconnect?: () => void;
    pending: Map<string, { resolve(value: string[] | null): void; timer: ReturnType<typeof setTimeout> }>;
}

/* The socket is outside the PTY: a startup read on stdin cannot consume command bytes. */
export function openShellEditor(env: Record<string, string>, prompt: ShellPrompt): { bind(pid: number): void } {
    const directory = mkdtempSync('/tmp/ruimte-zle-');
    chmodSync(directory, 0o700);
    const path = join(directory, 'editor.sock');
    const secret = crypto.randomUUID();
    let pid: number | null = null;
    const peers = new Set<Socket<Peer>>();
    const server = Bun.listen<Peer>({
        unix: path,
        socket: {
            open(socket) {
                socket.data = { buffer: '', authorized: false, decoder: new TextDecoder(), pending: new Map() };
                peers.add(socket);
            },
            data(socket, bytes) {
                const peer = socket.data;
                peer.buffer += peer.decoder.decode(bytes, { stream: true });
                if (peer.buffer.length > 16_384) {
                    socket.terminate();
                    return;
                }
                let end: number;
                while ((end = peer.buffer.indexOf('\n')) >= 0) {
                    const fields = peer.buffer.slice(0, end).split('\t');
                    peer.buffer = peer.buffer.slice(end + 1);
                    if (!peer.authorized) {
                        if (fields.length !== 4 || fields[0] !== 'hello' || fields[1] !== secret || fields[2] !== String(pid) || fields[3] !== '2') {
                            socket.terminate();
                            return;
                        }
                        peer.authorized = true;
                        peer.disconnect = prompt.connect(connection(socket));
                    } else {
                        const request = peer.pending.get(fields[0]!);
                        if (request) {
                            clearTimeout(request.timer);
                            peer.pending.delete(fields[0]!);
                            request.resolve(fields.slice(1));
                        }
                    }
                }
            },
            close: closePeer,
            error: closePeer
        }
    });
    chmodSync(path, 0o600);
    env.RUIMTE_EDITOR_SOCKET = path;
    env.RUIMTE_EDITOR_SECRET = secret;
    env.RUIMTE_EDITOR_PERMITS = directory;
    prompt.onDispose(() => {
        for (const peer of peers) {
            peer.terminate();
            closePeer(peer);
        }
        server.stop(true);
        rmSync(directory, { recursive: true, force: true });
    });
    return {
        bind(value) {
            pid = value;
        }
    };

    function closePeer(socket: Socket<Peer>): void {
        peers.delete(socket);
        socket.data.disconnect?.();
        for (const pending of socket.data.pending.values()) {
            clearTimeout(pending.timer);
            pending.resolve(null);
        }
        socket.data.pending.clear();
    }

    function request(socket: Socket<Peer>, kind: string, cwd = '-', command = '-', signal?: AbortSignal): Promise<string[] | null> {
        return new Promise((resolve) => {
            const id = crypto.randomUUID();
            const permit = join(directory, `${id}.permit`);
            const claimed = join(directory, `${id}.claimed`);
            const revoke = (): void => {
                try {
                    unlinkSync(permit);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                        throw error;
                    }
                }
            };
            const finish = (value: string[] | null): void => {
                signal?.removeEventListener('abort', revoke);
                if (signal) {
                    revoke();
                    rmSync(claimed, { force: true });
                }
                resolve(value);
            };
            if (signal) {
                if (signal.aborted) {
                    resolve(['refused']);
                    return;
                }
                writeFileSync(permit, '', { flag: 'wx', mode: 0o600 });
                signal.addEventListener('abort', revoke, { once: true });
            }
            const deadline = Date.now() + 1000;
            const timer = setTimeout(() => {
                // A timed-out request must not survive until a later editor cycle.
                socket.terminate();
                closePeer(socket);
            }, 1000);
            socket.data.pending.set(id, { resolve: finish, timer });
            const frame = `${id}\t${kind}\t${deadline}\t${cwd}\t${command}\n`;
            if (socket.write(frame) !== Buffer.byteLength(frame)) {
                socket.terminate();
                closePeer(socket);
            }
        });
    }

    function connection(socket: Socket<Peer>): ShellEditorConnection {
        return {
            async inspect(): Promise<ShellEditorState | null> {
                const reply = await request(socket, 'inspect');
                return reply?.length === 3 && reply[0] === 'state' && ['empty', 'occupied'].includes(reply[2]!)
                    ? { cwd: reply[1]!, empty: reply[2] === 'empty' }
                    : null;
            },
            async prepare(cwd, command, signal): Promise<ShellPrepareOutcome> {
                const reply = await request(socket, 'prepare', cwd, command, signal);
                return reply?.length === 1 && reply[0] === 'prepared' ? 'inserted' : reply?.length === 1 && reply[0] === 'refused' ? 'refused' : 'unconfirmed';
            },
            close() {
                socket.terminate();
                closePeer(socket);
            }
        };
    }
}

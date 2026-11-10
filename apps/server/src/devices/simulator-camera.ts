import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { cancellableTimeout, type Timer } from '@adecore/utils/async';
import { DeviceError } from './device-error.ts';
import { isVideo, requireMedia } from './device-paths.ts';
import { besideDaemon, serveSimFolder } from './serve-sim.ts';

interface CameraHelperProcess {
    kill(): void;
}

/* What a camera feed needs from the machine; tests hand in a fake. */
export interface CameraHost {
    /* The helper and the library a simulator app loads; null when this build carries neither. */
    readonly files: { helper: string; injector: string } | null;
    spawn(helper: string, arguments_: string[]): CameraHelperProcess;
    listening(socket: string): Promise<boolean>;
    send(socket: string, command: Record<string, string>): Promise<boolean>;
}

type SimctlEnvRunner = (arguments_: string[], env: Record<string, string>) => Promise<{ exitCode: number; stderr: string }>;

type CameraSource = 'placeholder' | 'file' | 'off';

/* A helper answers a command at once; one that has not by now is taken for gone and started again. */
const CAMERA_SEND_TIMEOUT_MS = 5_000;

interface Feed {
    process: CameraHelperProcess;
    socket: string;
    shm: string;
    apps: Set<string>;
}

/* Where the helper and the library are: beside the compiled daemon, else in the serve-sim package. */
function cameraFiles(): CameraHost['files'] {
    const compiled = { helper: besideDaemon('serve-sim-camera-helper'), injector: besideDaemon('libSimCameraInjector.dylib') };
    if (existsSync(compiled.helper) && existsSync(compiled.injector)) {
        return compiled;
    }
    const simcam = serveSimFolder('simcam');
    if (simcam === null) {
        return null;
    }
    const dependency = { helper: join(simcam, 'serve-sim-camera-helper'), injector: join(simcam, 'libSimCameraInjector.dylib') };
    return existsSync(dependency.helper) && existsSync(dependency.injector) ? dependency : null;
}

/*
 * The camera feed of the simulators: one helper per simulator writes frames into shared memory, and an
 * app reads them through the library it was launched with, so choosing the feed relaunches that app
 * once and switching it later does not. Names carry the machine's home, so a development daemon beside
 * an installed one never shares a helper.
 */
export class SimulatorCamera {
    private readonly home: string;
    private readonly host: CameraHost;
    private readonly simctl: SimctlEnvRunner;
    private readonly timer: Timer;
    private readonly feeds = new Map<string, Feed>();

    constructor(home: string, host: CameraHost, simctl: SimctlEnvRunner, timer: Timer = cancellableTimeout) {
        this.home = home;
        this.host = host;
        this.simctl = simctl;
        this.timer = timer;
    }

    get available(): boolean {
        return this.host.files !== null;
    }

    async set(deviceId: string, appId: string, source: CameraSource, path?: string): Promise<void> {
        if (source === 'off') {
            const feed = this.feeds.get(deviceId);
            this.stop(deviceId);
            if (feed?.apps.has(appId)) {
                await this.relaunch(deviceId, appId, {});
            }
            return;
        }
        const files = this.host.files;
        if (files === null) {
            throw new DeviceError('device-helper-unavailable', 'This machine has no camera helper for simulators');
        }
        const command = this.sourceCommand(source, path);
        let feed = this.feeds.get(deviceId);
        // A helper that went away since is started again, and its apps with it.
        if (feed !== undefined && !(await this.sendWithin(feed.socket, { action: 'switch', ...command }))) {
            this.stop(deviceId);
            feed = undefined;
        }
        feed ??= await this.start(deviceId, files.helper, command);
        if (!feed.apps.has(appId)) {
            await this.simctl(['privacy', deviceId, 'grant', 'camera', appId], {});
            await this.relaunch(deviceId, appId, { SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: files.injector, SIMCTL_CHILD_SIMCAM_SHM_NAME: feed.shm });
            feed.apps.add(appId);
        }
    }

    /* Ends the feed of a simulator that shuts down or is erased; its apps read no frames after it. */
    stop(deviceId: string): void {
        this.feeds.get(deviceId)?.process.kill();
        this.feeds.delete(deviceId);
    }

    stopAll(): void {
        for (const deviceId of [...this.feeds.keys()]) {
            this.stop(deviceId);
        }
    }

    private sendWithin(socket: string, command: Record<string, string>): Promise<boolean> {
        return new Promise((resolve) => {
            const cancel = this.timer(CAMERA_SEND_TIMEOUT_MS, () => resolve(false));
            this.host.send(socket, command).then(
                (accepted) => {
                    cancel();
                    resolve(accepted);
                },
                () => {
                    cancel();
                    resolve(false);
                }
            );
        });
    }

    private sourceCommand(source: 'placeholder' | 'file', path: string | undefined): { source: string; arg?: string } {
        if (source === 'placeholder') {
            return { source: 'placeholder' };
        }
        if (path === undefined) {
            throw new DeviceError('device-path-refused', 'A camera picture from a file needs the path of that file');
        }
        requireMedia([path]);
        return { source: isVideo(path) ? 'video' : 'image', arg: path };
    }

    private async start(deviceId: string, helper: string, command: { source: string; arg?: string }): Promise<Feed> {
        const key = createHash('sha1').update(`${this.home}\n${deviceId}`).digest('hex');
        // A socket path holds at most 104 bytes and a shared memory name 31, so both stay short and out of the home folder.
        const socket = `/tmp/ruimte-cam-${key.slice(0, 12)}.sock`;
        const shm = `/ruimte-cam-${key.slice(0, 8)}`;
        const arguments_ = ['--shm', shm, '--socket', socket, '--source', command.source, ...(command.arg === undefined ? [] : ['--arg', command.arg])];
        // What a helper of an earlier daemon left there would answer for this one, or keep it from listening.
        await rm(socket, { force: true });
        const process = this.host.spawn(helper, arguments_);
        if (!(await this.host.listening(socket))) {
            process.kill();
            throw new DeviceError('device-helper-failed', 'The camera helper did not start');
        }
        const feed = { process, socket, shm, apps: new Set<string>() };
        this.feeds.set(deviceId, feed);
        return feed;
    }

    /* An app picks its camera library at launch, so it starts again; one that was not running just starts. */
    private async relaunch(deviceId: string, appId: string, env: Record<string, string>): Promise<void> {
        await this.simctl(['terminate', deviceId, appId], {});
        const launched = await this.simctl(['launch', deviceId, appId], env);
        if (launched.exitCode !== 0) {
            throw new DeviceError('simctl-failed', launched.stderr.trim() || `simctl could not launch ${appId}`);
        }
    }
}

/* simctl with variables for the app it launches, which it passes on without their `SIMCTL_CHILD_` prefix. */
export async function simctlWithEnv(arguments_: string[], env: Record<string, string>): Promise<{ exitCode: number; stderr: string }> {
    const child = Bun.spawn(['xcrun', 'simctl', ...arguments_], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', env: { ...Bun.env, ...env } });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    return { exitCode, stderr };
}

const LISTEN_TRIES = 30;
const LISTEN_INTERVAL_MS = 100;

let foundFiles: CameraHost['files'] | undefined;

function answersOn(socket: string): Promise<boolean> {
    return Bun.connect({
        unix: socket,
        socket: {
            open: (connection) => {
                connection.end();
            },
            data: () => undefined
        }
    }).then(
        () => true,
        () => false
    );
}

/* The machine's own helper: a process of its own, spoken to over its unix socket. */
export const realCameraHost: CameraHost = {
    get files() {
        foundFiles ??= process.platform === 'darwin' ? cameraFiles() : null;
        return foundFiles;
    },
    spawn(helper, arguments_) {
        const child = Bun.spawn([helper, ...arguments_], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
        return { kill: () => child.kill() };
    },
    // A helper killed with the daemon leaves its socket behind, so only a connection says one listens.
    async listening(socket) {
        for (let attempt = 0; attempt < LISTEN_TRIES; attempt += 1) {
            if (existsSync(socket) && (await answersOn(socket))) {
                return true;
            }
            await Bun.sleep(LISTEN_INTERVAL_MS);
        }
        return false;
    },
    async send(socket, command) {
        const reply = await new Promise<string>((resolve, reject) => {
            let text = '';
            Bun.connect({
                unix: socket,
                socket: {
                    open: (connection) => {
                        connection.write(`${JSON.stringify(command)}\n`);
                    },
                    data: (connection, data) => {
                        text += data.toString();
                        if (text.includes('\n')) {
                            connection.end();
                            resolve(text);
                        }
                    },
                    close: () => resolve(text),
                    error: (_connection, error) => reject(error)
                }
            }).catch(reject);
        });
        try {
            return (JSON.parse(reply.split('\n')[0] ?? '') as { ok?: unknown }).ok === true;
        } catch {
            return false;
        }
    }
};

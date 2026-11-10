import type { DeviceFoldPose } from '@ruimte/contracts';

export type FoldPanel = 'cover' | 'inner';

/* The hinge angle of each pose of an iPhone Duo, as the simulator's own presets have them. */
export const POSE_DEGREES: Readonly<Record<DeviceFoldPose, number>> = { closed: 0, tent: 80, tabletop: 100, book: 130, open: 180 };

/*
 * The framebuffer of each panel of an iPhone Duo in pixels, from the simulator's device type. Not
 * read from `simctl io enumerate`, whose output on a Duo was not seen here; a device test checks it.
 */
export const PANEL_SIZES: Readonly<Record<FoldPanel, { width: number; height: number }>> = {
    cover: { width: 1398, height: 2034 },
    inner: { width: 2007, height: 2853 }
};

/* Which panel an angle shows while SpringBoard has not said: under 90 degrees the cover. */
export function panelOfAngle(degrees: number): FoldPanel {
    return degrees < 90 ? 'cover' : 'inner';
}

export function panelOfLine(line: string): FoldPanel | null {
    if (line.includes('.cover:pri')) {
        return 'cover';
    }
    return line.includes('.inner:pri') ? 'inner' : null;
}

const PREDICATE = 'process == "SpringBoard" AND category == "DisplayContentMode"';

export interface LogProcess {
    readonly lines: AsyncIterable<string>;
    readonly exited: Promise<number>;
    kill(): void;
}

type LogSpawn = (command: readonly string[]) => LogProcess;

function spawnLog(command: readonly string[]): LogProcess {
    const child = Bun.spawn([...command], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    async function* lines(): AsyncIterable<string> {
        const decoder = new TextDecoder();
        let rest = '';
        for await (const chunk of child.stdout) {
            const parts = (rest + decoder.decode(chunk, { stream: true })).split('\n');
            rest = parts.pop() ?? '';
            yield* parts;
        }
        if (rest !== '') {
            yield rest;
        }
    }
    return { lines: lines(), exited: child.exited, kill: () => child.kill('SIGTERM') };
}

interface FoldPanelMonitorOptions {
    udid: string;
    onPanel: (panel: FoldPanel) => void;
    spawn?: LogSpawn;
    /* Waits before a stream that died is started again. */
    wait?: (ms: number) => Promise<void>;
}

const RESTART_MS = 2_000;

/*
 * Follows which panel of a foldable simulator SpringBoard shows, from its own log: the last report of
 * this boot first, then every new one, the stream started again when it dies. Between a pose and
 * its report the angle decides, since an intermediate pose shows the panel of the way it was folded.
 */
export class FoldPanelMonitor {
    private readonly options: FoldPanelMonitorOptions;
    private readonly spawn: LogSpawn;
    private readonly wait: (ms: number) => Promise<void>;
    private current: LogProcess | null = null;
    private stopped = false;
    private done: Promise<void> | null = null;

    constructor(options: FoldPanelMonitorOptions) {
        this.options = options;
        this.spawn = options.spawn ?? spawnLog;
        this.wait = options.wait ?? ((ms) => Bun.sleep(ms));
    }

    start(): void {
        this.done ??= this.run();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        this.current?.kill();
        await this.done;
    }

    private async run(): Promise<void> {
        const last = await this.read([
            'xcrun',
            'simctl',
            'spawn',
            this.options.udid,
            'log',
            'show',
            '--last',
            'boot',
            '--style',
            'compact',
            '--predicate',
            PREDICATE
        ]);
        if (last !== null && !this.stopped) {
            this.options.onPanel(last);
        }
        while (!this.stopped) {
            await this.read(['xcrun', 'simctl', 'spawn', this.options.udid, 'log', 'stream', '--style', 'compact', '--predicate', PREDICATE], (panel) =>
                this.options.onPanel(panel)
            );
            if (!this.stopped) {
                await this.wait(RESTART_MS);
            }
        }
    }

    private async read(command: readonly string[], each?: (panel: FoldPanel) => void): Promise<FoldPanel | null> {
        if (this.stopped) {
            return null;
        }
        const process = this.spawn(command);
        this.current = process;
        let last: FoldPanel | null = null;
        try {
            for await (const line of process.lines) {
                const panel = panelOfLine(line);
                if (panel !== null) {
                    last = panel;
                    each?.(panel);
                }
            }
        } catch {
            // A log that breaks off is started again like one that ended.
        }
        await process.exited;
        if (this.current === process) {
            this.current = null;
        }
        return last;
    }
}

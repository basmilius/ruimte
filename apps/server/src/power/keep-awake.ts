import type { AgentInfo, ChatInfo, KeepAwakeMode } from '@ruimte/contracts';

export interface KeepAwakeSetting {
    mode: KeepAwakeMode;
    onBattery: boolean;
    display: boolean;
}

export interface KeepAwakeWork {
    sessions: readonly { exited: boolean; agent?: AgentInfo | null }[];
    chats: readonly Pick<ChatInfo, 'status' | 'delegating'>[];
}

/*
 * Whether an agent is in the middle of a turn, the way the client's `agentsWorking` counts it: a
 * terminal agent only while its hooks say `running` and its CLI is live, a chat in a turn or between
 * turns with subagents still at work. Waiting on a person is not work.
 */
export function agentsWorking(work: KeepAwakeWork): boolean {
    return (
        work.sessions.some((session) => !session.exited && session.agent?.live === true && session.agent.status === 'running') ||
        work.chats.some((chat) => chat.status === 'running' || (chat.status === 'idle' && chat.delegating === true))
    );
}

/* Where the daemon can hold a block. Only macOS ships a tool that holds one for as long as a process lives. */
export function keepAwakeAvailable(platform: NodeJS.Platform): boolean {
    return platform === 'darwin';
}

/* Whether the setting asks for a block right now, before the power source has a say. */
export function keepAwakeWanted(setting: KeepAwakeSetting, working: boolean, platform: NodeJS.Platform): boolean {
    return keepAwakeAvailable(platform) && setting.mode !== 'off' && (setting.mode !== 'working' || working);
}

/*
 * The command that holds the block, or null for none. `-w` ties it to the daemon, so a daemon that is
 * killed never leaves the Mac awake. `-s` holds on the power adapter only and `-i` on any source. The
 * display is held only with `-i`: caffeinate has no display assertion that lets go on battery, and
 * `-d` there would keep a laptop on battery awake that a person said should sleep.
 */
export function keepAwakeCommand(setting: KeepAwakeSetting, working: boolean, platform: NodeJS.Platform, pid: number): string[] | null {
    if (!keepAwakeWanted(setting, working, platform)) {
        return null;
    }
    const display = setting.mode === 'always' && setting.display && setting.onBattery;
    return ['caffeinate', '-w', String(pid), setting.onBattery ? '-i' : '-s', ...(display ? ['-d'] : [])];
}

export interface HeldProcess {
    kill(): void;
    readonly exited: Promise<unknown>;
}

/* Starts a process that holds the block; a test hands in a fake, so no test runs a real one. */
export type KeepAwakeSpawn = (command: string[]) => HeldProcess;

export interface KeepAwakeOptions {
    platform: NodeJS.Platform;
    pid: number;
    setting(): KeepAwakeSetting;
    work(): KeepAwakeWork;
    spawn: KeepAwakeSpawn;
    log(line: string): void;
}

/*
 * The machine's block on sleep, held by the daemon so it holds without a window open and for a daemon
 * from npm. Checked on every change of what an agent does and of the setting, never on a clock.
 */
export class KeepAwake {
    private readonly options: KeepAwakeOptions;
    private held: { key: string; process: HeldProcess } | null = null;
    private stopped = false;

    constructor(options: KeepAwakeOptions) {
        this.options = options;
    }

    get available(): boolean {
        return keepAwakeAvailable(this.options.platform);
    }

    /* Whether a block is held right now. */
    get holding(): boolean {
        return this.held !== null;
    }

    check(): void {
        if (this.stopped) {
            return;
        }
        const command = keepAwakeCommand(this.options.setting(), agentsWorking(this.options.work()), this.options.platform, this.options.pid);
        const key = command?.join(' ') ?? null;
        if ((this.held?.key ?? null) === key) {
            return;
        }
        const previous = this.held;
        this.held = command === null || key === null ? null : this.start(command, key);
        // The new block is up before the old one goes, so the machine is never without one in between.
        previous?.process.kill();
    }

    stop(): void {
        this.stopped = true;
        this.held?.process.kill();
        this.held = null;
    }

    private start(command: string[], key: string): { key: string; process: HeldProcess } | null {
        let process: HeldProcess;
        try {
            process = this.options.spawn(command);
        } catch (e) {
            this.options.log(`Keeping this machine awake failed: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        }
        const held = { key, process };
        // A block that ended without being asked to is forgotten, so the next check starts it again.
        void process.exited.then(() => {
            if (this.held === held) {
                this.held = null;
                this.options.log('The process keeping this machine awake ended; it starts again at the next change');
            }
        });
        return held;
    }
}

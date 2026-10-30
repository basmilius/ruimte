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

export interface KeepAwakeBlock {
    onBattery: boolean;
    display: boolean;
}

/* Where the daemon can hold a block: `caffeinate` on macOS and `SetThreadExecutionState` on Windows. */
export function keepAwakeAvailable(platform: NodeJS.Platform): boolean {
    return platform === 'darwin' || platform === 'win32';
}

/* Whether the setting asks for a block right now, before the power source has a say. */
export function keepAwakeWanted(setting: KeepAwakeSetting, working: boolean, platform: NodeJS.Platform): boolean {
    return keepAwakeAvailable(platform) && setting.mode !== 'off' && (setting.mode !== 'working' || working);
}

/*
 * The block the setting comes down to, or null for none. The display is held only for a block that may
 * hold on battery: caffeinate has no display assertion that lets go there, and the setting reads the same
 * on every platform.
 */
export function keepAwakeBlock(setting: KeepAwakeSetting, working: boolean, platform: NodeJS.Platform): KeepAwakeBlock | null {
    if (!keepAwakeWanted(setting, working, platform)) {
        return null;
    }
    return { onBattery: setting.onBattery, display: setting.mode === 'always' && setting.display && setting.onBattery };
}

/* `-w` ties it to the daemon, so a daemon that is killed never leaves the Mac awake. `-s` holds on the power adapter only and `-i` on any source. */
export function caffeinateCommand(block: KeepAwakeBlock, pid: number): string[] {
    return ['caffeinate', '-w', String(pid), block.onBattery ? '-i' : '-s', ...(block.display ? ['-d'] : [])];
}

export interface HeldProcess {
    kill(): void;
    readonly exited: Promise<unknown>;
}

interface KeepAwakeOptions {
    platform: NodeJS.Platform;
    setting(): KeepAwakeSetting;
    work(): KeepAwakeWork;
    /* Starts holding the block; a test hands in a fake, so no test holds a real one. */
    hold(block: KeepAwakeBlock): HeldProcess;
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

    get holding(): boolean {
        return this.held !== null;
    }

    check(): void {
        if (this.stopped) {
            return;
        }
        const block = keepAwakeBlock(this.options.setting(), agentsWorking(this.options.work()), this.options.platform);
        const key = block === null ? null : JSON.stringify(block);
        if ((this.held?.key ?? null) === key) {
            return;
        }
        const previous = this.held;
        this.held = block === null || key === null ? null : this.start(block, key);
        // The new block is up before the old one goes, so the machine is never without one in between.
        previous?.process.kill();
    }

    stop(): void {
        this.stopped = true;
        this.held?.process.kill();
        this.held = null;
    }

    private start(block: KeepAwakeBlock, key: string): { key: string; process: HeldProcess } | null {
        let process: HeldProcess;
        try {
            process = this.options.hold(block);
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

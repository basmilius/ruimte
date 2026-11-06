import { join } from 'node:path';
import { nodeSessionFs } from '@adecore/agents/chat';
import type { Clock } from '@adecore/agents/coordination';
import { ProviderAccountsService } from '@adecore/agents/providers';
import { fakeClaude, fakeCodex, inProcess, type FakeCli, type InProcessCli } from '@adecore/agents/testing';
import type { AgentKind, Worktree } from '@ruimte/contracts';
import { parseServerArgs, type ServerConfig } from '../config.ts';
import type { MachineHome } from '../disk/machine-home.ts';
import { Checkpoints } from '../git/checkpoints.ts';
import type { GhRunner } from '../git/github.ts';
import { PrSplits } from '../git/pr-split.ts';
import { Worktrees } from '../git/worktrees.ts';
import type { OutboxWork } from '../outbox/outbox.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { FakePtyAdapter } from '../pty/fake-pty.ts';
import type { PtyAdapter } from '../pty/pty.ts';
import { untilChecked } from '../until-test-helpers.ts';
import { openAiLive } from '../voice/openai-live.ts';
import { loopbackUrls, type DaemonRuntime } from '../wiring/runtime.ts';
import type { DaemonSeams } from '../wiring/seams.ts';

/* The configuration of a daemon in a test: its own home, nothing fetched, no hooks written, nobody reached from outside. */
export function testConfig(home: string): ServerConfig {
    return parseServerArgs(
        ['--no-hooks', '--no-price-fetch', '--no-model-fetch', '--no-stun', '--no-broker', '--no-lan', '--port', '0', '--label', 'test-machine'],
        { RUIMTE_HOME: home }
    );
}

/* Where a test daemon runs from: the URLs a session is told, on a port nothing listens on. */
export function testRuntime(home: string): DaemonRuntime {
    return { config: testConfig(home), compiled: false, sourceDir: join(import.meta.dir, '..'), ...loopbackUrls(4210) };
}

/* Git as a folder outside any repository answers it, without asking git. */
class NoWorktrees extends Worktrees {
    override async list(): Promise<Worktree[]> {
        throw new Error('not a git repository');
    }

    override async registeredPaths(): Promise<string[]> {
        return [];
    }

    override async branches(): Promise<string[]> {
        throw new Error('not a git repository');
    }

    override async add(): Promise<never> {
        throw new Error('no worktrees here');
    }

    override async addFresh(): Promise<never> {
        throw new Error('no worktrees here');
    }

    override async claim(): Promise<void> {}

    override async remove(): Promise<never> {
        throw new Error('no worktrees here');
    }
}

class NoCheckpoints extends Checkpoints {
    override async take(): Promise<null> {
        return null;
    }

    override async diff(): Promise<null> {
        return null;
    }

    override async settle(): Promise<null> {
        return null;
    }

    override async head(): Promise<null> {
        return null;
    }
}

const NO_GH: GhRunner = () => Promise.resolve({ code: 1, stdout: '', stderr: 'no gh in this test' });

/* What a test reads from the fakes its seams brought in. */
export interface TestFakes {
    /* The fake terminals, which stay empty when `ptyAdapter` brings real ones. */
    adapter: FakePtyAdapter;
    claude: InProcessCli;
    codex: InProcessCli;
    /* The environment of every chat CLI started, oldest first. */
    chatEnvs: Array<Record<string, string>>;
    /* The command line of every chat CLI started, oldest first. */
    chatCommands: string[][];
    alerts: string[];
    /* Every piece of work owed since boot, kept after the worker took it off the outbox. */
    enqueued: OutboxWork[];
    drops: Promise<void>[];
    /* Resolves once `check` holds, looked at again each time `recheck` runs. */
    until(check: () => boolean): Promise<void>;
    recheck(): void;
}

export interface TestSeamChoices {
    home: string;
    clock: Clock;
    /* The CLIs this machine says it has; Claude Code alone unless a test needs another. */
    installed?: AgentKind[];
    /* What runs as Claude Code; the plain fake unless a test needs one that misbehaves. */
    claudeCli?: FakeCli;
    /* What runs as Codex; the plain fake unless a test needs another. */
    codexCli?: FakeCli;
    /* What runs a terminal; the fake adapter unless a measurement needs real processes. */
    ptyAdapter?: PtyAdapter;
    /* The environment every CLI starts from. */
    env?: Record<string, string | undefined>;
    /* What `gh` answers a pull request watch; every call fails without it. */
    gh?: GhRunner;
}

export type TestSeams = DaemonSeams & { fakes: TestFakes };

/*
 * The seams of a daemon in a test: fake terminals and CLIs, a clock the test moves, no git and no
 * browser. `overrides` replaces whole seams; what a test only wants to look at is in `fakes`.
 */
export function testSeams(choices: TestSeamChoices, overrides: Partial<DaemonSeams> = {}): TestSeams {
    const { home, clock, installed = ['claude'], claudeCli = fakeClaude, codexCli = fakeCodex, ptyAdapter, gh = NO_GH } = choices;
    const env = choices.env ?? { PATH: process.env.PATH, HOME: home };
    const { until, recheck } = untilChecked();
    const adapter = new FakePtyAdapter();
    const claude = inProcess(claudeCli);
    const codex = inProcess(codexCli);
    const chatEnvs: Array<Record<string, string>> = [];
    const chatCommands: string[][] = [];
    const alerts: string[] = [];
    const enqueued: OutboxWork[] = [];
    const drops: Promise<void>[] = [];
    const fakes: TestFakes = { adapter, claude, codex, chatEnvs, chatCommands, alerts, enqueued, drops, until, recheck };
    const seams: DaemonSeams = {
        clock,
        random: () => 0.5,
        env,
        pty: ptyAdapter ?? adapter,
        chatSpawn: (options) => {
            chatEnvs.push(options.env);
            chatCommands.push([...options.command]);
            return options.command[0]?.endsWith('codex') ? codex.spawn(options) : claude.spawn(options);
        },
        providers: {
            detect: async (command) => ({ installed: (installed as string[]).includes(command), version: '0.0.0' }),
            added: []
        },
        accounts: ({ home: accountsHome, providers }) =>
            new ProviderAccountsService({
                home: accountsHome,
                providers,
                env,
                ask: async () => ({ signedIn: true, email: null, plan: null, organization: null }),
                prepareShadow: async () => ({ linked: [], unshared: [], sharedLogin: false }),
                secrets: null
            }),
        git: {
            worktrees: ({ home: gitHome, agents, now, checkoutRoot, foreign }) => new NoWorktrees(gitHome, agents, now, checkoutRoot, foreign),
            checkpoints: (gitHome: string, machineHome: MachineHome) => new NoCheckpoints(gitHome, machineHome),
            gh,
            splits: new PrSplits(gh),
            repositoryOf: async () => null
        },
        projectStore: ({ home: storeHome, links, overlays }) => new ProjectStore(storeHome, links, overlays),
        nameChat: async () => null,
        usage: { probe: async () => ({ unavailable: { reason: 'not-installed', message: null } }) },
        language: { run: () => Promise.reject(new Error('no toolchain in this test')), findProgram: () => [] },
        visualLauncher: () => {
            throw new Error('no browser in this test');
        },
        voiceLive: openAiLive(),
        machine: { model: async () => null, codexProbe: async () => undefined, sessionFs: nodeSessionFs },
        remote: { connections: (real) => real, reconnect: (real) => real },
        peerNotify: (real) => real,
        observers: {
            enqueued: (work) => {
                enqueued.push(work);
                recheck();
            },
            dropped: (drop) => void drops.push(drop),
            failed: () => undefined,
            alerted: (_target, nodeId, title, body) => void alerts.push(`${nodeId}\t${title}\t${body}`),
            log: () => undefined,
            limits: () => undefined
        },
        ...overrides
    };

    return { ...seams, fakes };
}

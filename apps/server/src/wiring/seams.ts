import type { SessionFs, SpawnChatProcess, suggestChatTitle } from '@adecore/agents/chat';
import type { Clock } from '@adecore/agents/coordination';
import type { ChatProvider, CliDetection, ProviderAccountsOptions, ProviderAccountsService } from '@adecore/agents/providers';
import type { LimitsUpdate, UsageMonitorOptions } from '@adecore/agents/usage';
import type { MachineHome } from '../disk/machine-home.ts';
import type { Checkpoints } from '../git/checkpoints.ts';
import type { GhRunner } from '../git/github.ts';
import type { PrSplits } from '../git/pr-split.ts';
import type { WorktreeAgents } from '../git/worktree-merge.ts';
import type { Worktrees } from '../git/worktrees.ts';
import type { RunCommand } from '../language/runtime.ts';
import type { OutboxWork } from '../outbox/outbox.ts';
import type { ConnectPeer } from '../peer/giver/connect-peer.ts';
import type { RemoteConnections } from '../peer/giver/remote-connections.ts';
import type { ProjectOverlays } from '../projects/overlays.ts';
import type { ProjectLinks, ProjectStore } from '../projects/project-store.ts';
import type { PtyAdapter } from '../pty/pty.ts';
import type { RenderLauncher } from '../visuals/renderer.ts';
import type { OpenAiLive } from '../voice/openai-live.ts';

/*
 * What the wiring tells that something happened, for a caller that waits on it or writes it down.
 * The daemon logs; a test collects.
 */
export interface WiringObservers {
    /* Every piece of work after it is on the outbox's disk. */
    enqueued(work: OutboxWork): void;
    /* An unused fork a deleted node took along, so a caller can wait for the removal. */
    dropped(drop: Promise<void>): void;
    /* A prune of a store that failed. */
    failed(what: string, error: unknown): void;
    /* Attention raised on a node, beside the push to a phone. */
    alerted(target: 'chat' | 'terminal', nodeId: string, title: string, body: string): void;
    /* The log of what ends the agents a node opened. */
    log(line: string): void;
    /* What a running turn says about the plan of its account. */
    limits(update: LimitsUpdate): void;
}

/* What the accounts of the CLIs are built from, which only the wiring of the providers knows. */
export interface AccountsInput {
    home: string;
    providers: ProviderAccountsOptions['providers'];
    install: NonNullable<ProviderAccountsOptions['install']>;
    ownsSettings: NonNullable<ProviderAccountsOptions['ownsSettings']>;
}

/* What the wiring of the git services is built from. */
export interface WorktreesInput {
    home: string;
    agents: WorktreeAgents;
    now(): number;
    checkoutRoot(): string | null;
    foreign: NonNullable<ConstructorParameters<typeof Worktrees>[4]>;
}

/* What a project store is made from: the services that follow it, and the files it lays over a document. */
export interface ProjectStoreInput {
    home: string;
    links: ProjectLinks;
    overlays: ProjectOverlays;
}

/*
 * Everything a test replaces in the daemon, in one object. `startDaemon` hands the real values
 * (`productionSeams`), a test builds its own (`testSeams`), and `wireDaemon` wires the same modules
 * either way, so a port a module needs is passed to it from here and not given a default there.
 */
export interface DaemonSeams {
    clock: Clock;
    random(): number;
    /* The environment every terminal and chat CLI starts from. */
    env: Record<string, string | undefined>;
    pty: PtyAdapter;
    /* Starts the process of a chat's CLI. */
    chatSpawn: SpawnChatProcess;
    providers: {
        /* How a CLI is found and asked for its version; null leaves it to each provider. */
        detect: ((command: string) => Promise<CliDetection>) | null;
        /* Providers in place of the built-in ones of their kind. */
        added: readonly ChatProvider[];
        /* What `codex --help` prints, which decides the terminal flags Codex takes; null runs the real Codex. */
        codexHelp: ((executable: string) => Promise<string>) | null;
    };
    accounts(input: AccountsInput): ProviderAccountsService;
    git: {
        worktrees(input: WorktreesInput): Worktrees;
        checkpoints(home: string, machineHome: MachineHome): Checkpoints;
        /* What `gh` answers a pull request watch, and the sizes it reads the pull requests it watches by. */
        gh: GhRunner;
        splits: PrSplits;
        /* The repository a file is in, for who wrote which lines. */
        repositoryOf(directory: string): Promise<string | null>;
    };
    projectStore(input: ProjectStoreInput): ProjectStore;
    /* Names a chat by asking a one-shot CLI. */
    nameChat: typeof suggestChatTitle;
    usage: {
        /* How the plan of a CLI's account is read; null starts the CLI and asks it. */
        probe: UsageMonitorOptions['probe'] | null;
    };
    language: {
        /* Runs a command of a language server's toolchain. */
        run: RunCommand;
        /* Where a toolchain's program may be. */
        findProgram(program: string): string[];
    };
    /* Starts the child that renders a visual. */
    visualLauncher: RenderLauncher;
    voiceLive: OpenAiLive;
    machine: {
        /* The hardware's name in a person's words. */
        model(): Promise<string | null>;
        sessionFs(): Promise<SessionFs>;
    };
    /* The links to other machines, which a test replaces by one it controls. */
    remote: {
        connections(real: RemoteConnections): Pick<RemoteConnections, 'link'>;
        reconnect(real: ConnectPeer): Pick<ConnectPeer, 'owe'>;
    };
    /* Tells a machine that works here its task settled. */
    peerNotify(real: (machineId: string, nodeId: string) => void): (machineId: string, nodeId: string) => void;
    observers: WiringObservers;
}

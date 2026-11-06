import { nodeSessionFs, spawnChatProcess, suggestChatTitle } from '@adecore/agents/chat';
import { systemClock } from '@adecore/agents/coordination';
import { ProviderAccountsService } from '@adecore/agents/providers';
import { errorText } from '../error-text.ts';
import { Checkpoints } from '../git/checkpoints.ts';
import { runGh } from '../git/github.ts';
import { prSplits } from '../git/pr-split.ts';
import { Worktrees } from '../git/worktrees.ts';
import { runCommand } from '../language/runtime.ts';
import { toolchainCandidates } from '../language/toolchain.ts';
import { readMachineModel } from '../machine-model.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { repositoryOf } from '../provenance/file-versions.ts';
import { RUIMTE_ACCOUNTS_HOST } from '../providers/accounts-host.ts';
import { RUIMTE_CODEX_CLIENT } from '../providers/codex-provider.ts';
import { probeCodexNoDaemon } from '../providers/launch.ts';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
import { childLauncher, renderCommand } from '../visuals/renderer.ts';
import { openAiLive } from '../voice/openai-live.ts';
import type { DaemonRuntime } from './runtime.ts';
import type { DaemonSeams } from './seams.ts';

/* The real values of every seam: real processes, the system clock, the machine's own git and accounts. */
export function productionSeams(runtime: DaemonRuntime): DaemonSeams {
    const failed = (what: string, error: unknown): void => console.error(`${what}:`, errorText(error));

    return {
        clock: systemClock,
        random: Math.random,
        env: process.env,
        pty: new BunPtyAdapter(),
        chatSpawn: spawnChatProcess,
        providers: { detect: null, added: [] },
        accounts: ({ home, providers, install }) =>
            new ProviderAccountsService({ home, host: RUIMTE_ACCOUNTS_HOST, client: RUIMTE_CODEX_CLIENT, providers, install }),
        git: {
            worktrees: ({ home, agents, now, checkoutRoot, foreign }) => new Worktrees(home, agents, now, checkoutRoot, foreign),
            checkpoints: (home, machineHome) => new Checkpoints(home, machineHome),
            gh: runGh,
            splits: prSplits,
            repositoryOf
        },
        projectStore: ({ home, links, overlays }) => new ProjectStore(home, links, overlays),
        nameChat: suggestChatTitle,
        usage: { probe: null },
        language: { run: runCommand, findProgram: toolchainCandidates },
        visualLauncher: childLauncher(renderCommand(runtime.compiled, process.execPath, process.execArgv, runtime.sourceDir)),
        voiceLive: openAiLive(),
        machine: { model: readMachineModel, codexProbe: () => probeCodexNoDaemon(), sessionFs: nodeSessionFs },
        remote: { connections: (real) => real, reconnect: (real) => real },
        peerNotify: (real) => real,
        observers: {
            enqueued: () => undefined,
            dropped: (drop) => void drop.catch((e: unknown) => failed('Removing an unused fork failed', e)),
            failed,
            alerted: () => undefined,
            log: (line) => console.error(line),
            limits: () => undefined
        }
    };
}

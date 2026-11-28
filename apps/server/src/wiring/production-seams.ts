import { nodeSessionFs, spawnChatProcess, suggestChatTitle } from '@adecore/agents/chat';
import { systemClock } from '@adecore/agents/coordination';
import { ProviderAccountsService } from '@adecore/agents/providers';
import { errorText } from '../error-text.ts';
import { runMachineStep } from '../extensions/machine-steps.ts';
import { developmentExtensionRoots } from '../extensions/provenance.ts';
import { Checkpoints } from '../git/checkpoints.ts';
import { Worktrees } from '../git/worktrees.ts';
import { runCommand } from '../language/runtime.ts';
import { toolchainCandidates } from '../language/toolchain.ts';
import { readMachineModel } from '../machine-model.ts';
import { macClosedLidSystem } from '../power/closed-lid-system.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { repositoryOf } from '../provenance/file-versions.ts';
import { RUIMTE_ACCOUNTS_HOST } from '../providers/accounts-host.ts';
import { refreshAgentModels } from '../providers/model-refresh.ts';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
import { nodeSkillDisk } from '../skills/skill-disk.ts';
import { rememberSecret, watchProjects } from '../telemetry/reporter.ts';
import { childLauncher, renderCommand } from '../visuals/renderer.ts';
import { openAiLive } from '../voice/openai-live.ts';
import { blockHolder } from './power.ts';
import type { DaemonRuntime } from './runtime.ts';
import type { DaemonSeams } from './seams.ts';

export function productionSeams(runtime: DaemonRuntime): DaemonSeams {
    const failed = (what: string, error: unknown): void => console.error(`${what}:`, errorText(error));

    return {
        clock: systemClock,
        random: Math.random,
        env: process.env,
        pty: new BunPtyAdapter(),
        chatSpawn: spawnChatProcess,
        providers: { detect: null, added: [], codexHelp: null, refreshModels: refreshAgentModels },
        accounts: ({ home, providers, install, ownsSettings }) =>
            new ProviderAccountsService({ home, host: RUIMTE_ACCOUNTS_HOST, providers, install, ownsSettings }),
        git: {
            worktrees: ({ home, agents, now, checkoutRoot, foreign }) => new Worktrees(home, agents, now, checkoutRoot, foreign),
            checkpoints: (home, machineHome) => new Checkpoints(home, machineHome),
            repositoryOf
        },
        projectStore: ({ home, links, overlays }) => new ProjectStore(home, links, overlays),
        nameChat: suggestChatTitle,
        usage: { probe: null },
        language: { run: runCommand, findProgram: toolchainCandidates },
        visualLauncher: childLauncher(renderCommand(runtime.compiled, process.execPath, process.execArgv, runtime.sourceDir)),
        skillDisk: nodeSkillDisk,
        voiceLive: openAiLive(),
        power: { hold: blockHolder, closedLid: macClosedLidSystem },
        machine: { model: readMachineModel, sessionFs: nodeSessionFs },
        developmentExtensions: developmentExtensionRoots(runtime.compiled, runtime.sourceDir),
        machineSteps: runMachineStep,
        remote: { connections: (real) => real, reconnect: (real) => real },
        peerNotify: (real) => real,
        observers: {
            enqueued: () => undefined,
            dropped: (drop) => void drop.catch((e: unknown) => failed('Removing an unused fork failed', e)),
            failed,
            alerted: () => undefined,
            log: (line) => console.error(line),
            limits: () => undefined
        },
        redactions: { secret: rememberSecret, projects: watchProjects }
    };
}

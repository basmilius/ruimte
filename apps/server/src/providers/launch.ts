import { cliExecutable, type CliMcpServer, type ChatProvider } from '@adecore/agents/providers';
import { resumeCommandFor, type AgentKind, type AgentLaunch, type RuntimeMode } from '@ruimte/contracts';
import { MCP_SERVER } from '../ruimte-mcp.ts';

/* Where a line is built from: the provider of each kind, which says how its CLI takes a mode, a model and a server. */
export interface LaunchProviders {
    get(kind: AgentKind): ChatProvider;
}

// What a terminal agent starts in when nobody said otherwise; the same default a new chat has.
export const DEFAULT_RUNTIME_MODE: RuntimeMode = 'full-access';

/*
 * The widest mode a terminal agent can be running in, as far as the daemon started it: a fresh launch
 * without a mode got the default, while a resume without one and a CLI a person typed into a plain
 * shell run with whatever that CLI decides, which the daemon cannot know and so takes as the strictest.
 */
export function launchedMode(launch: AgentLaunch | null): RuntimeMode {
    if (launch === null) {
        return 'supervised';
    }
    return launch.runtimeMode ?? (launch.resume ? 'supervised' : DEFAULT_RUNTIME_MODE);
}

export function quote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

/* A `-c` stays a bare word; every value is quoted. */
function quoted(args: readonly string[]): string[] {
    return args.map((arg) => (arg === '-c' ? arg : quote(arg)));
}

/*
 * What a CLI gets on every line, fresh or resumed, whatever the mode: Ruimte's MCP server, which no CLI keeps from
 * one start to the next, and leave to use it, then what the CLI itself says it needs now (Codex's `--no-daemon`).
 */
function alwaysFlags(provider: ChatProvider, mcp: CliMcpServer | undefined): string[] {
    const terminal = provider.terminal;
    const flags = quoted([...(mcp === undefined ? [] : (terminal?.mcpArgs?.(mcp) ?? [])), ...(terminal?.mcpAllowArgs?.(MCP_SERVER) ?? [])]);

    return [...flags, ...(terminal?.extraArgs?.() ?? [])];
}

/*
 * Whether the line a CLI of this kind was launched with carried the tools note, so its hook must not say it a
 * second time. A resume carries none, and keeps what its session started with, which for a session from before
 * the tools may still name `ruimte-context`: its hook says the note, so the agent learns the tools.
 */
export function noteOnLine(provider: ChatProvider, launch: AgentLaunch | null | undefined): boolean {
    return provider.terminal?.noteArgs !== undefined && launch?.kind === provider.kind && !launch.resume;
}

/*
 * What a launch puts on a CLI's line beside the command itself: the permission mode and, where the
 * CLI takes one, the model. A launch that names no mode gets no mode flag; only a fresh launch fills
 * that gap with `DEFAULT_RUNTIME_MODE`, because a resume of a CLI nobody chose a mode for would
 * otherwise be handed full access. A CLI or mode without flags launches bare, which leaves that CLI's own
 * default in place: a missing flag is always the safer of the two mistakes.
 */
function launchFlags(provider: ChatProvider, launch: AgentLaunch, runtimeMode: RuntimeMode | undefined, mcp: CliMcpServer | undefined): string[] {
    const terminal = provider.terminal;
    const flags = [...alwaysFlags(provider, mcp), ...(runtimeMode === undefined ? [] : (terminal?.modeArgs?.[runtimeMode] ?? []))];

    if (launch.model && terminal?.modelFlag) {
        flags.push(terminal.modelFlag, quote(launch.model));
    }

    return flags;
}

/*
 * Put the first prompt on the launch command because CLIs expose no reliable ready-for-input signal.
 * Building the line in the daemon also keeps flags out of the wire protocol.
 */
export function terminalCommand(providers: LaunchProviders, launch: AgentLaunch, firstPrompt?: string, note?: string, mcp?: CliMcpServer): string {
    const provider = providers.get(launch.kind);

    if (!provider.capabilities.terminal) {
        throw new Error(`${provider.name} is only available as a chat.`);
    }

    if (launch.resume) {
        return resumeCommand(providers, launch, launch.resume, mcp);
    }

    // Only the executable: the arguments on a provider are the ones its chat backend needs.
    const parts = [cliExecutable(provider), ...launchFlags(provider, launch, launch.runtimeMode ?? DEFAULT_RUNTIME_MODE, mcp)];

    if (note && provider.terminal?.noteArgs) {
        parts.push(...quoted(provider.terminal.noteArgs(note)));
    }

    if (firstPrompt) {
        parts.push(...provider.firstPromptArgs(firstPrompt).map(quote));
    }

    return parts.join(' ');
}

/*
 * How each CLI is told to pick its session up again; the template is the provider's own. The mode
 * and the model ride along, so a node comes back the way it was started whether its CLI resumes or
 * starts fresh. Claude Code 2.1.270 reads both out of the transcript it resumes (measured), and is
 * then told the same thing twice; Codex takes its sandbox and its approval policy from the line
 * alone, so without this a `full-access` node would come back sandboxed.
 */
export function resumeCommand(providers: LaunchProviders, launch: AgentLaunch, agentSessionId: string, mcp?: CliMcpServer): string {
    const provider = providers.get(launch.kind);

    return resumeCommandFor(provider.resumeCommand, agentSessionId, launchFlags(provider, launch, launch.runtimeMode, mcp));
}

/* The line a CLI starts fresh with, whatever the launch it was recorded with asked to resume. */
export function freshCommand(providers: LaunchProviders, launch: AgentLaunch, note?: string, mcp?: CliMcpServer): string {
    return terminalCommand(providers, { ...launch, resume: undefined }, undefined, note, mcp);
}

/*
 * A resume the daemon has no evidence for, in one line. The CLI exits non-zero when the session it
 * was handed is not there, so the shell then starts a fresh one itself.
 */
export function resumeOrFreshCommand(providers: LaunchProviders, launch: AgentLaunch, agentSessionId: string, note?: string, mcp?: CliMcpServer): string {
    return `${resumeCommand(providers, launch, agentSessionId, mcp)} || ${freshCommand(providers, launch, note, mcp)}`;
}

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { claudeProjectSlug, type BackendChange, type BackendLaunch } from '@adecore/agents/chat';
import { createClaudeProvider, type ChatProvider, type ClaudeCodeRuntime, type CliDetection } from '@adecore/agents/providers';
import { claudeTranscriptRoot, type UsageRootPath } from '@adecore/agents/usage';
import { withRuimteMcp } from '../ruimte-mcp.ts';
import type { AnthropicClaudeApiService } from './anthropic-claude-api-service.ts';
import { cliMcpServers, readApiMcpConfigSync } from './api-mcp.ts';

// The CLI's own configuration folder for these chats, so the person's sign-in, settings and sessions stay out.
const CONFIG_FOLDER = 'claude-config';

interface ClaudeApiProviderOptions {
    // How to probe the CLI; a test answers without spawning anything.
    readonly detect?: ChatProvider['detect'];
}

/* Where Claude Code keeps its sessions and transcripts for these chats, once the service is loaded. */
export function claudeApiConfigDir(service: AnthropicClaudeApiService): string {
    return join(service.directory, CONFIG_FOLDER);
}

/* What the usage page reads: the log of the turns from before these chats ran in Claude Code, and the CLI's transcripts since. */
export function claudeApiUsageRoots(service: AnthropicClaudeApiService): UsageRootPath[] {
    return [{ provider: 'anthropic-claude-api', path: service.usageDirectory }, claudeTranscriptRoot('anthropic-claude-api', claudeApiConfigDir(service))];
}

function hasTranscript(projectsDir: string, cwd: string, sessionId: string): boolean {
    const file = `${sessionId}.jsonl`;

    if (/[/\\]|\.\./.test(sessionId)) {
        return false;
    }

    if (existsSync(join(projectsDir, claudeProjectSlug(cwd), file))) {
        return true;
    }

    // The CLI may have written the session under another folder's slug, as `findClaudeSession` allows for.
    try {
        return readdirSync(projectsDir).some((folder) => existsSync(join(projectsDir, folder, file)));
    } catch {
        return false;
    }
}

/*
 * A chat from before these chats ran in Claude Code holds the id of a thread the daemon kept itself, which the CLI
 * has never seen, so it starts a session of its own instead of failing on that id. Its old messages stay in the thread.
 */
function withoutForeignResume(launch: BackendLaunch, configDir: string): BackendLaunch {
    if (launch.resume === null || hasTranscript(join(configDir, 'projects'), launch.cwd, launch.resume)) {
        return launch;
    }

    return { ...launch, resume: null };
}

/*
 * Claude Code on the key a person saved in Settings, beside their own sign-in. It is there once the key brought models
 * and the CLI is installed. The servers of `api-mcp.json` the CLI can load go along with Ruimte's own. `claude` is
 * the provider of Claude Code itself, whose command, capabilities and install steps these chats share.
 */
export function createAnthropicClaudeApiProvider(
    service: AnthropicClaudeApiService,
    claude: ChatProvider,
    options: ClaudeApiProviderOptions = {}
): ChatProvider {
    const detectClaude = options.detect ?? claude.detect;
    // Only Claude Code itself offers a fork; a chat on a key never did.
    const { fork: _fork, ...capabilities } = claude.capabilities;

    return {
        kind: 'anthropic-claude-api',
        name: 'Claude API',
        command: claude.command,
        // A terminal would run on the person's own sign-in, so nothing resumes these sessions there.
        resumeCommand: '',
        catalog: service.catalog,
        ignoresProjectConfig: true,
        capabilities: { ...capabilities, terminal: false, hooks: false },
        subagentSource: 'claude-transcript',
        launch: withRuimteMcp,
        ...(claude.install ? { install: claude.install } : {}),
        // Read only once a chat runs, by when the daemon loaded the service and its folder is known.
        get claudeCode(): ClaudeCodeRuntime {
            return { configDir: claudeApiConfigDir(service) };
        },
        detect: async (command, env): Promise<CliDetection> => {
            const { configured, models } = service.status();

            if (!configured || models === 0) {
                return { installed: false, version: null };
            }

            const cli = await detectClaude(command, env);

            return { installed: cli.installed, version: cli.installed ? 'API key' : null };
        },
        firstPromptArgs: () => {
            throw new Error('The Claude API is only available as a chat.');
        },
        onChange: (listener) => service.onChange(listener),
        createBackend: (launch, host) => {
            if (!service.apiKey) {
                throw new Error('Add an Anthropic API key in Settings → Providers.');
            }

            const configDir = claudeApiConfigDir(service);
            const keyed = createClaudeProvider({ apiKey: { key: () => service.apiKey, configDir } });
            const mcpServers = [...(launch.mcpServers ?? []), ...cliMcpServers(readApiMcpConfigSync(dirname(service.directory)))];
            const limit = service.maxOutputTokensFor(launch.selection.model);
            const env = { ...launch.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(limit) };
            const backend = keyed.createBackend({ ...withoutForeignResume(launch, configDir), env, mcpServers }, host);
            const inPlace = backend.reconfigure?.bind(backend);
            // The CLI reads its output limit only as it starts, so a new limit, or a model with another one, needs a new process.
            const outdated = (change: BackendChange): boolean => service.maxOutputTokensFor(change.selection.model) !== limit;

            return Object.assign(backend, {
                outdated,
                reconfigure: async (change: BackendChange): Promise<boolean> => !outdated(change) && inPlace !== undefined && (await inPlace(change))
            });
        }
    };
}

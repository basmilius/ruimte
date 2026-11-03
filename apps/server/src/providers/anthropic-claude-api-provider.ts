import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { claudeProjectSlug, type BackendLaunch } from '@adecore/agents/chat';
import { createClaudeProvider, type ChatProvider, type ClaudeCodeRuntime, type CliDetection } from '@adecore/agents/providers';
import { claudeTranscriptRoot, type UsageRootPath } from '@adecore/agents/usage';
import { cliMcpServers, readApiMcpConfigSync } from '../chat/api-mcp.ts';
import { AnthropicClaudeApiService } from './anthropic-claude-api-service.ts';
import { claudeProvider } from './claude-provider.ts';
import { withRuimteMcp } from './ruimte-mcp.ts';

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
 * and the CLI is installed. The servers of `api-mcp.json` the CLI can load go along with Ruimte's own.
 */
export function createAnthropicClaudeApiProvider(service: AnthropicClaudeApiService, options: ClaudeApiProviderOptions = {}): ChatProvider {
    const detectClaude = options.detect ?? claudeProvider.detect;

    return {
        kind: 'anthropic-claude-api',
        name: 'Claude API',
        command: claudeProvider.command,
        // A terminal would run on the person's own sign-in, so nothing resumes these sessions there.
        resumeCommand: '',
        catalog: service.catalog,
        ignoresProjectConfig: true,
        capabilities: { ...claudeProvider.capabilities, terminal: false, hooks: false },
        ...(claudeProvider.install ? { install: claudeProvider.install } : {}),
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
            const claude = createClaudeProvider({ apiKey: { key: () => service.apiKey, configDir } });
            const mcpServers = [...(launch.mcpServers ?? []), ...cliMcpServers(readApiMcpConfigSync(dirname(service.directory)))];
            const env = { ...launch.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(service.maxOutputTokensFor(launch.selection.model)) };

            return claude.createBackend(withRuimteMcp({ ...withoutForeignResume(launch, configDir), env, mcpServers }, 'variable'), host);
        }
    };
}

/*
 * One per daemon, so the places without a registry at hand (`providerFor`) see the same name and models
 * as the registry. The daemon loads it from its home at boot.
 */
export const anthropicClaudeApiService = new AnthropicClaudeApiService(fetch, claudeProvider.catalog);
export const anthropicClaudeApiProvider = createAnthropicClaudeApiProvider(anthropicClaudeApiService);

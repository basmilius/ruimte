import type { AcpClientInfo } from '@adecore/agents/chat';
import {
    cliMcpAllowArgs,
    createAntigravityProvider as createSharedAntigravityProvider,
    createCopilotProvider as createSharedCopilotProvider,
    createGrokProvider as createSharedGrokProvider,
    type AcpCatalogStore,
    type AcpServerLaunch,
    type AcpVendorOptions,
    type ChatProvider
} from '@adecore/agents/providers';
import { parseAcpServerRelease } from './acp-server.ts';
import antigravityRelease from './antigravity-acp-release.json' with { type: 'json' };
import { MCP_SERVER, withRuimteMcp } from './ruimte-mcp.ts';

// How the daemon names itself to every ACP agent it starts.
export const RUIMTE_ACP_CLIENT: AcpClientInfo = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

/* Google's ACP server for Antigravity, pinned to the release the ACP registry lists (`antigravity-acp`). */
export const ANTIGRAVITY_ACP_RELEASE = parseAcpServerRelease(antigravityRelease);

/* Every built-in ACP agent names Ruimte and loads Ruimte's MCP server in its chats. */
function ruimteChats(catalogStore: AcpCatalogStore | undefined): AcpVendorOptions {
    return { client: RUIMTE_ACP_CLIENT, launch: (launch) => withRuimteMcp(launch), ...(catalogStore === undefined ? {} : { catalogStore }) };
}

export function createGrokProvider(catalogStore?: AcpCatalogStore): ChatProvider {
    return createSharedGrokProvider(ruimteChats(catalogStore));
}

export const grokProvider: ChatProvider = createGrokProvider();

/*
 * A chat's Copilot loads Ruimte's MCP server from its session request. Its permission requests name no server, so
 * the allow flag on its line is what runs the server's tools without asking (measured on Copilot CLI 1.0.104).
 */
export function createCopilotProvider(catalogStore?: AcpCatalogStore, usageLog?: string): ChatProvider {
    return createSharedCopilotProvider({
        ...ruimteChats(catalogStore),
        args: cliMcpAllowArgs('copilot', MCP_SERVER),
        ...(usageLog === undefined ? {} : { usageLog })
    });
}

export const copilotProvider: ChatProvider = createCopilotProvider();

/* Without an installed server a chat cannot start; the person installs one from the Providers pane. */
export function createAntigravityProvider(server: AcpServerLaunch | null, catalogStore?: AcpCatalogStore): ChatProvider {
    const provider = createSharedAntigravityProvider({ ...ruimteChats(catalogStore), server });

    return {
        ...provider,
        get command() {
            return provider.command;
        },
        get capabilities() {
            return provider.capabilities;
        },
        createBackend: (launch, host) => {
            if (server?.launch() == null) {
                throw new Error('Install the Antigravity server in Settings, Providers first.');
            }

            return provider.createBackend(launch, host);
        }
    };
}

/* An ACP agent whose chats load Ruimte's MCP server, for a provider whose `createBackend` is the one `createAcpProvider` made. */
export function loadingRuimteMcp(provider: ChatProvider): ChatProvider {
    return { ...provider, createBackend: (launch, host) => provider.createBackend(withRuimteMcp(launch), host) };
}

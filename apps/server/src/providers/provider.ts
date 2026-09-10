import type { AgentKind, ProviderCapabilities } from '@ruimte/contracts';
import type { BackendHost, BackendLaunch, ChatBackend } from '../chat/backend.ts';
import type { ModelCatalog } from './catalog.ts';
import type { CliDetection } from './detect.ts';

/*
 * One agent CLI as the daemon knows it. Everything a provider does differently is either data on
 * this value or behind the backend it makes, so a new CLI is a value plus a backend and nothing
 * else changes: the session, the projector, the manager and the wire stay as they are.
 */
export interface ChatProvider {
    readonly kind: AgentKind;
    readonly name: string;
    readonly catalog: ModelCatalog;
    readonly capabilities: ProviderCapabilities;
    // The executable and its leading arguments; a test points this at a fake CLI.
    readonly command: string[];
    // What a terminal runs to continue one of this CLI's sessions; `{id}` stands for the session id.
    readonly resumeCommand: string;
    /* The arguments for one prompt in and one answer out, no session and no chat, which is how the
       daemon asks for a commit message. Absent on a CLI that only runs interactively. */
    oneShotArgs?(prompt: string): string[];
    detect(command: string, env: Record<string, string | undefined>): Promise<CliDetection>;
    createBackend(launch: BackendLaunch, host: BackendHost): ChatBackend;
}

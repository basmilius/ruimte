import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import { ModelCatalog } from './catalog.ts';
import { detectCli, type CliDetection } from './claude.ts';

// How long a "is it installed" answer stays good; an install mid-session shows up on the next check.
const DETECTION_TTL_MS = 60_000;

/* What the daemon knows about each agent CLI: whether it is there and which models it offers. */
export class ProviderRegistry {
    readonly claude = new ModelCatalog();
    private readonly commands: Record<AgentKind, string>;
    private readonly cache = new Map<AgentKind, { at: number; detection: CliDetection }>();
    private readonly detect: (command: string) => Promise<CliDetection>;

    constructor(options: { commands?: Partial<Record<AgentKind, string>>; detect?: (command: string) => Promise<CliDetection> } = {}) {
        this.commands = { claude: 'claude', codex: 'codex', ...options.commands };
        this.detect = options.detect ?? detectCli;
    }

    async list(): Promise<ProviderInfo[]> {
        const [claude, codex] = await Promise.all([this.detection('claude'), this.detection('codex')]);
        return [
            { kind: 'claude', name: 'Claude Code', ...claude, models: this.claude.list(), defaultModel: this.claude.defaultModel },
            // Codex has hooks but no chat backend yet; it shows up so the person knows it was seen.
            { kind: 'codex', name: 'Codex', ...codex, models: [], defaultModel: null }
        ];
    }

    private async detection(kind: AgentKind): Promise<CliDetection> {
        const cached = this.cache.get(kind);
        if (cached && Date.now() - cached.at < DETECTION_TTL_MS) {
            return cached.detection;
        }
        const detection = await this.detect(this.commands[kind]);
        this.cache.set(kind, { at: Date.now(), detection });
        return detection;
    }
}

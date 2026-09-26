import clsx from 'clsx';
import type { AgentKind } from '@ruimte/agent-contracts';
import { AgentIcon } from '../agents/AgentIcon';

// Each CLI in its color of the usage charts, so a mark here reads as the same CLI there.
const CLI_COLORS: Record<AgentKind, string> = {
    apple: 'text-text-muted',
    claude: 'text-chart-claude',
    codex: 'text-chart-codex',
    gemini: 'text-chart-gemini',
    copilot: 'text-chart-copilot'
};

export function CliMark({ kind, size = 14, className }: { kind: AgentKind; size?: number; className?: string }) {
    return <AgentIcon kind={kind} size={size} className={clsx('shrink-0', CLI_COLORS[kind], className)} />;
}

/* As tall as the title's first line, so the mark sits beside the name rather than between the two lines. */
export function CliTile({ kind }: { kind: AgentKind }) {
    return (
        <span className="grid h-6 shrink-0 place-items-center">
            <CliMark kind={kind} size={24} />
        </span>
    );
}

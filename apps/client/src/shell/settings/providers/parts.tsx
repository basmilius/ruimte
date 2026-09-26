import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { AgentKind } from '@ruimte/contracts';
import { AgentIcon } from '@ruimte/agents-react/agents/AgentIcon';

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

/* The head of a detail: a mark, the name, a line under it, and the actions of the thing. */
export function DetailHeader({ mark, title, subtitle, actions }: { mark: ReactNode; title: string; subtitle: ReactNode; actions?: ReactNode }) {
    return (
        <header className="flex min-w-0 flex-wrap items-start gap-3">
            {mark}
            <div className="min-w-0 grow basis-48">
                <h3 className="truncate text-lg font-semibold text-text">{title}</h3>
                <div className="flex min-w-0 items-center gap-1.5 text-xs break-words text-text-muted">{subtitle}</div>
            </div>
            {actions}
        </header>
    );
}

/* As tall as the title's first line, so the mark sits beside the name rather than between the two lines. */
export function CliTile({ kind }: { kind: AgentKind }) {
    return (
        <span className="grid h-6 shrink-0 place-items-center">
            <CliMark kind={kind} size={24} />
        </span>
    );
}

/* The red outline of a step that forgets something, softer than the filled button of a deletion that cannot come back. */
export const REMOVE_BUTTON =
    'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-status-error/35 px-3 text-xs font-medium text-status-error hover:bg-status-error/10 disabled:opacity-40 disabled:hover:bg-transparent';

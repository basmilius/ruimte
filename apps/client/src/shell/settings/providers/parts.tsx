import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { AgentKind } from '@ruimte/contracts';
import { ACCOUNT_COLORS, accountDotClass } from '@/agents/accounts';
import { AgentIcon } from '@/agents/AgentIcon';

// Each CLI in its color of the usage charts, so a mark here reads as the same CLI there.
const CLI_COLORS: Record<AgentKind, string> = {
    claude: 'text-chart-claude',
    codex: 'text-chart-codex',
    gemini: 'text-chart-gemini',
    copilot: 'text-chart-copilot'
};

export function CliMark({ kind, size = 14, className }: { kind: AgentKind; size?: number; className?: string }) {
    return <AgentIcon kind={kind} size={size} className={clsx('shrink-0', CLI_COLORS[kind], className)} />;
}

export function AccountDot({ color, className }: { color: string | undefined; className?: string }) {
    return <span aria-hidden className={clsx('shrink-0 rounded-full', accountDotClass(color), className ?? 'size-2')} />;
}

/* The head of a detail: a mark, the name, a line under it, and the actions of the thing. */
export function DetailHeader({ mark, title, subtitle, actions }: { mark: ReactNode; title: string; subtitle: ReactNode; actions?: ReactNode }) {
    return (
        <header className="flex min-w-0 flex-wrap items-center gap-3">
            {mark}
            <div className="min-w-0 grow basis-48">
                <h3 className="truncate text-lg font-semibold text-text">{title}</h3>
                <div className="flex min-w-0 items-center gap-1.5 text-xs break-words text-text-muted">{subtitle}</div>
            </div>
            {actions}
        </header>
    );
}

export function CliTile({ kind }: { kind: AgentKind }) {
    return (
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-hover">
            <CliMark kind={kind} size={20} />
        </span>
    );
}

/* The swatches of an account, one of which is always picked. */
export function ColorSwatches({ value, onChange, label }: { value: string | undefined; onChange(color: string): void; label: string }) {
    const { t } = useTranslation('settings');
    return (
        <div role="radiogroup" aria-label={label} className="flex items-center gap-2">
            {ACCOUNT_COLORS.map((color) => (
                <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={value === color}
                    aria-label={t(`providers.account.colors.${color}`)}
                    className={clsx('size-4 rounded-full', accountDotClass(color), value === color && 'ring-2 ring-text ring-offset-2 ring-offset-surface')}
                    onClick={() => onChange(color)}
                />
            ))}
        </div>
    );
}

/* The red outline of a step that forgets something, softer than the filled button of a deletion that cannot come back. */
export const REMOVE_BUTTON =
    'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-status-error/35 px-3 text-xs font-medium text-status-error hover:bg-status-error/10 disabled:opacity-40 disabled:hover:bg-transparent';

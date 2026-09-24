import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComputerAppEntry, ComputerAppGrants as Grants, ComputerRevokePayload } from '@ruimte/contracts';
import { formatDayWithYear } from '@/format/datetime';
import { useFormatLocale } from '@/format/locale';
import { Button } from '@/ui/Button';
import { Tooltip } from '@/ui/Tooltip';

interface ComputerAppGrantsProps {
    readonly grants: Grants;
    /* An agent operates Ruimte, and the machine refuses this window a person's decisions until they take over. */
    readonly held: boolean;
    readonly busy: boolean;
    onRevoke(revoke: ComputerRevokePayload): void;
}

/* What a person allowed on one machine, each with the button that takes it back. */
export function ComputerAppGrants({ grants, held, busy, onRevoke }: ComputerAppGrantsProps) {
    const { t } = useTranslation(['settings', 'common']);
    useFormatLocale();
    const disabled = held || busy;
    return (
        <div className="flex min-w-0 flex-col gap-3">
            <GrantGroup title={t('computer.apps.always')} empty={grants.always.length === 0 ? t('computer.apps.alwaysEmpty') : null}>
                {grants.always.map((entry) => (
                    <GrantRow key={entry.bundleId} entry={entry} detail={t('computer.apps.allowed', { date: formatDayWithYear(entry.at) })}>
                        <Button
                            size="sm"
                            disabled={disabled}
                            aria-label={t('computer.apps.removeLabel', { app: entry.name })}
                            onClick={() => onRevoke({ bundleId: entry.bundleId, kind: 'always' })}
                        >
                            {t('computer.apps.remove')}
                        </Button>
                    </GrantRow>
                ))}
            </GrantGroup>
            <GrantGroup title={t('computer.apps.terminals')} empty={grants.terminals.length === 0 ? t('computer.apps.terminalsEmpty') : null}>
                {grants.terminals.map((entry) => (
                    <GrantRow key={entry.bundleId} entry={entry} detail={t('computer.apps.seen', { date: formatDayWithYear(entry.at) })}>
                        <Tooltip label={t('computer.apps.notTerminalHint')}>
                            <Button
                                size="sm"
                                disabled={disabled}
                                aria-label={t('computer.apps.notTerminalLabel', { app: entry.name })}
                                onClick={() => onRevoke({ bundleId: entry.bundleId, kind: 'terminal' })}
                            >
                                {t('computer.apps.notTerminal')}
                            </Button>
                        </Tooltip>
                    </GrantRow>
                ))}
            </GrantGroup>
            {grants.thisTime.length > 0 && (
                <GrantGroup title={t('computer.apps.thisTime')} empty={null}>
                    {grants.thisTime.map((entry) => (
                        <GrantRow
                            key={`${entry.nodeId}\n${entry.bundleId}`}
                            entry={entry}
                            detail={[entry.nodeTitle ?? t('computer.apps.untitled'), entry.projectName].filter(Boolean).join(' · ')}
                        >
                            <Button
                                size="sm"
                                disabled={disabled}
                                aria-label={t('computer.apps.removeLabel', { app: entry.name })}
                                onClick={() => onRevoke({ bundleId: entry.bundleId, kind: 'thisTime', nodeId: entry.nodeId })}
                            >
                                {t('computer.apps.remove')}
                            </Button>
                        </GrantRow>
                    ))}
                </GrantGroup>
            )}
            {held && <p className="text-xs text-text-muted">{t('common:state.agentOperating')}</p>}
        </div>
    );
}

function GrantGroup({ title, empty, children }: { readonly title: string; readonly empty: string | null; readonly children: ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-1.5">
            <h4 className="text-xs text-text-muted">{title}</h4>
            {empty === null ? <ul className="flex min-w-0 flex-col gap-1">{children}</ul> : <p className="text-xs text-text-faint">{empty}</p>}
        </section>
    );
}

function GrantRow({ entry, detail, children }: { readonly entry: ComputerAppEntry; readonly detail: string; readonly children: ReactNode }) {
    return (
        <li className="flex min-w-0 items-center gap-3 rounded-lg bg-surface-raised py-1 pr-1 pl-3">
            <div className="flex min-w-0 grow items-baseline gap-2">
                <Tooltip label={entry.bundleId}>
                    <span className="max-w-full shrink-0 truncate text-sm text-text">{entry.name || entry.bundleId}</span>
                </Tooltip>
                <span className="min-w-0 truncate text-xs text-text-muted">{detail}</span>
            </div>
            {children}
        </li>
    );
}

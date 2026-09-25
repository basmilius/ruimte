import type { ReactNode } from 'react';
import { AppWindow, Clock, SquareTerminal, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComputerAppEntry, ComputerAppGrants as Grants, ComputerRevokePayload } from '@ruimte/contracts';
import { formatDayWithYear } from '@/format/datetime';
import { useFormatLocale } from '@/format/locale';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

interface ComputerAppGrantsProps {
    readonly grants: Grants;
    readonly busy: boolean;
    onRevoke(revoke: ComputerRevokePayload): void;
}

/* What a person allowed on one machine, each with the button that takes it back. */
export function ComputerAppGrants({ grants, busy, onRevoke }: ComputerAppGrantsProps) {
    const { t } = useTranslation('settings');
    useFormatLocale();
    return (
        <>
            <SettingsSection title={t('computer.apps.always')}>
                {grants.always.length === 0 && <SettingsRow muted label={t('computer.apps.alwaysEmpty')} />}
                {grants.always.map((entry) => (
                    <GrantRow key={entry.bundleId} entry={entry} icon={AppWindow} detail={t('computer.apps.allowed', { date: formatDayWithYear(entry.at) })}>
                        <Button
                            disabled={busy}
                            aria-label={t('computer.apps.removeLabel', { app: entry.name })}
                            onClick={() => onRevoke({ bundleId: entry.bundleId, kind: 'always' })}
                        >
                            {t('computer.apps.remove')}
                        </Button>
                    </GrantRow>
                ))}
            </SettingsSection>
            <SettingsSection title={t('computer.apps.terminals')}>
                {grants.terminals.length === 0 && <SettingsRow muted label={t('computer.apps.terminalsEmpty')} />}
                {grants.terminals.map((entry) => (
                    <GrantRow key={entry.bundleId} entry={entry} icon={SquareTerminal} detail={t('computer.apps.seen', { date: formatDayWithYear(entry.at) })}>
                        <Tooltip label={t('computer.apps.notTerminalHint')}>
                            <Button
                                disabled={busy}
                                aria-label={t('computer.apps.notTerminalLabel', { app: entry.name })}
                                onClick={() => onRevoke({ bundleId: entry.bundleId, kind: 'terminal' })}
                            >
                                {t('computer.apps.notTerminal')}
                            </Button>
                        </Tooltip>
                    </GrantRow>
                ))}
            </SettingsSection>
            {grants.thisTime.length > 0 && (
                <SettingsSection title={t('computer.apps.thisTime')}>
                    {grants.thisTime.map((entry) => (
                        <GrantRow
                            key={`${entry.nodeId}\n${entry.bundleId}`}
                            entry={entry}
                            icon={Clock}
                            detail={[entry.nodeTitle ?? t('computer.apps.untitled'), entry.projectName].filter(Boolean).join(' · ')}
                        >
                            <Button
                                disabled={busy}
                                aria-label={t('computer.apps.removeLabel', { app: entry.name })}
                                onClick={() => onRevoke({ bundleId: entry.bundleId, kind: 'thisTime', nodeId: entry.nodeId })}
                            >
                                {t('computer.apps.remove')}
                            </Button>
                        </GrantRow>
                    ))}
                </SettingsSection>
            )}
        </>
    );
}

interface GrantRowProps {
    readonly entry: ComputerAppEntry;
    readonly icon: LucideIcon;
    readonly detail: string;
    readonly children: ReactNode;
}

function GrantRow({ entry, icon, detail, children }: GrantRowProps) {
    return (
        <SettingsRow
            leading={
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-hover text-text-muted">
                    <Icon icon={icon} size={16} />
                </span>
            }
            label={
                <Tooltip label={entry.bundleId}>
                    <span className="max-w-full truncate">{entry.name || entry.bundleId}</span>
                </Tooltip>
            }
            description={detail}
            control={children}
        />
    );
}

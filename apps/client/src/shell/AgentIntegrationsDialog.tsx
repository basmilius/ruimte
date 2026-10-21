import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentIntegration, AgentIntegrationFile, AgentIntegrationReport, AgentKind } from '@ruimte/contracts';
import { CliMark } from '@adecore/agents-react/providers';
import { useLocalTilde } from '@/format/home-path';
import { INTEGRATION_NAMES, pendingReview, providersToKeep, setAgentIntegration, useAgentIntegrations } from '@/state/agent-integrations';
import { useUi } from '@/state/ui';
import { Button, Dialog, FormError, Skeleton } from '@adecore/ui';

const OUTCOME_KEYS = {
    written: 'written',
    unchanged: 'unchanged',
    removed: 'removed',
    deleted: 'deleted',
    none: 'none',
    'kept-edited': 'keptEdited',
    missing: 'missing',
    refused: 'refused',
    failed: 'failed'
} as const;

/* One line per file of what became of it; the reports of a revoke are what a person checks the result by. */
export function IntegrationReports({ reports }: { reports: readonly AgentIntegrationReport[] }) {
    const { t } = useTranslation('settings');
    const tilde = useLocalTilde();
    return (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-text-muted">
            {reports.map((report) => (
                <li key={report.path} className="break-all">
                    <span className="text-text">{t(`agents.integrations.outcome.${OUTCOME_KEYS[report.outcome]}`, { message: report.message ?? '' })}</span>{' '}
                    <span className="font-mono">{tilde(report.path)}</span>
                </li>
            ))}
        </ul>
    );
}

/*
 * What Ruimte writes for a provider and what stops working without it; shared by the dialog and the settings row.
 * `files` is null while the list loads. The consequence of saying no is only news while it is not allowed yet,
 * unless the caller asks for it (a row about to be kept or removed).
 */
export function IntegrationDetails({
    entry,
    files,
    consequence = entry.state !== 'on'
}: {
    entry: Pick<AgentIntegration, 'provider' | 'state'>;
    files: readonly AgentIntegrationFile[] | null;
    consequence?: boolean;
}) {
    const { t } = useTranslation('settings');
    const tilde = useLocalTilde();
    const own = files?.filter((file) => file.provider === entry.provider) ?? [];
    return (
        <div className="flex flex-col gap-1 text-xs text-text-muted">
            {files === null && <Skeleton className="h-4 w-48" />}
            {own.length > 0 && (
                <div>
                    <p>{t('agents.integrations.files')}</p>
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                        {own.map((file) => (
                            <li key={file.path} className="font-mono break-all">
                                {tilde(file.path)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {consequence && <p>{t('agents.integrations.off', { provider: INTEGRATION_NAMES[entry.provider] ?? entry.provider })}</p>}
            {entry.provider === 'codex' && <p>{t('agents.integrations.codexRule')}</p>}
            {entry.provider === 'antigravity' && <p>{t('agents.integrations.antigravityRule')}</p>}
        </div>
    );
}

// What a person gets from allowing each CLI, in one line; the files and the details live in the settings.
const DIALOG_GAINS: Partial<Record<AgentKind, string>> = {
    codex: 'settings:agents.integrations.dialog.statusAndTool',
    antigravity: 'settings:agents.integrations.dialog.doneAndTool'
};

/*
 * Asks once, per CLI, whether Ruimte may write its status hooks into that CLI's global settings. A
 * fresh machine writes nothing until a person answers; a machine that already carries the hooks
 * shows them once, preselected to stay.
 */
export function AgentIntegrationsDialog() {
    const { t } = useTranslation(['settings', 'common']);
    const open = useUi((s) => s.agentIntegrations);
    const summary = useAgentIntegrations();
    const [reports, setReports] = useState<Record<string, AgentIntegrationReport[]>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const answered = Object.keys(reports).length > 0;
    const pending = pendingReview(summary);
    const firstAsked = (summary?.providers ?? []).find(
        (entry) => reports[entry.provider] === undefined && (entry.state === 'unset' || (entry.state === 'on' && !entry.reviewed))
    );

    // Answered in another window: nothing is left to ask here, unless this window shows the report of its own answer.
    useEffect(() => {
        if (open && !pending && !answered) {
            useUi.getState().setAgentIntegrations(false);
        }
    }, [open, pending, answered]);

    const choose = async (provider: AgentIntegration['provider'], on: boolean): Promise<void> => {
        setBusy(provider);
        setError(null);
        try {
            const report = await setAgentIntegration(provider, on);
            setReports((current) => ({ ...current, [provider]: report }));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(null);
        }
    };

    // Leaving a migrated row without a choice keeps what it has, which counts as having seen it.
    const close = (): void => {
        for (const provider of providersToKeep(summary, Object.keys(reports), busy)) {
            void setAgentIntegration(provider, true).catch(() => undefined);
        }
        useUi.getState().setAgentIntegrations(false);
    };

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    close();
                }
            }}
        >
            <Dialog.Popup className="flex w-[560px] flex-col p-5">
                <Dialog.Title>{t('settings:agents.integrations.dialog.title')}</Dialog.Title>
                <Dialog.Description className="mt-1">{t('settings:agents.integrations.dialog.description')}</Dialog.Description>
                <div className="mt-4 -mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto px-1">
                    {(summary?.providers ?? []).map((entry) => {
                        const own = reports[entry.provider];
                        // After a choice the card shows its state; only a file that went wrong is named.
                        const failed = own?.filter((report) => report.outcome === 'failed' || report.outcome === 'refused') ?? [];
                        const migrated = entry.state === 'on' && !entry.reviewed;
                        return (
                            <section key={entry.provider} className="rounded-lg border border-border bg-surface bg-clip-padding p-3.5">
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
                                    <CliMark kind={entry.provider} size={16} />
                                    {INTEGRATION_NAMES[entry.provider] ?? entry.provider}
                                </h3>
                                {migrated && (
                                    <p className="mt-1 text-sm text-text-muted">
                                        {t('settings:agents.integrations.migrated', { provider: INTEGRATION_NAMES[entry.provider] ?? entry.provider })}
                                    </p>
                                )}
                                <p className="mt-1 text-sm text-text-muted">
                                    {t(DIALOG_GAINS[entry.provider] ?? 'settings:agents.integrations.dialog.status')}
                                </p>
                                {failed.length > 0 ? (
                                    <IntegrationReports reports={failed} />
                                ) : own === undefined && (entry.state === 'unset' || migrated) ? (
                                    <div className="mt-3 flex items-center gap-2">
                                        <Button
                                            variant="primary"
                                            autoFocus={entry === firstAsked}
                                            disabled={busy !== null}
                                            onClick={() => void choose(entry.provider, true)}
                                        >
                                            {t(migrated ? 'settings:agents.integrations.keep' : 'settings:agents.integrations.allow')}
                                        </Button>
                                        <Button variant="secondary" disabled={busy !== null} onClick={() => void choose(entry.provider, false)}>
                                            {t(migrated ? 'settings:agents.integrations.remove' : 'settings:agents.integrations.deny')}
                                        </Button>
                                    </div>
                                ) : (
                                    <p className="mt-2 text-xs text-text-muted">
                                        {t(entry.state === 'on' ? 'settings:agents.integrations.state.on' : 'settings:agents.integrations.state.off')}
                                    </p>
                                )}
                            </section>
                        );
                    })}
                </div>
                {error !== null && <FormError className="mt-3">{error}</FormError>}
                <Dialog.Footer>
                    <Button disabled={busy !== null} onClick={close}>
                        {t(pending ? 'settings:agents.integrations.notNow' : 'common:action.done')}
                    </Button>
                </Dialog.Footer>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

import { Button, Icon } from '@adecore/ui';
import { DetailHeader, SettingsRow } from '@adecore/ui/settings';
import type { MachineCandidate, MachineStartProgram } from '@ruimte/contracts';
import { Container } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { signInPageOf, underWay, useCandidateActions } from '@/machine-ui/machine-candidates';
import { SettingsSection } from '@/machines/SettingsSection';

function Program({ program }: { program: MachineStartProgram }) {
    const { t } = useTranslation('settings');

    return (
        <SettingsRow
            label={program.login === true ? t('machines.sources.held.signIn') : program.title}
            description={
                <span className="flex min-w-0 flex-col gap-0.5">
                    <code className="font-mono break-all text-text">{program.command}</code>
                    <span className="break-all">{t('machines.sources.held.folder', { folder: program.cwd })}</span>
                </span>
            }
        />
    );
}

/*
 * One place an extension can start a machine in. A start shows what would run on this computer and waits for a yes.
 * The new machine joins the account through its own sign-in, which this pane only relays: the page and the code are
 * in what the start wrote, and the person opens the page and approves there.
 */
export function MachineCandidateDetail({ projectId, candidate }: { projectId: string; candidate: MachineCandidate }) {
    const { t } = useTranslation('settings');
    const { failure, start, stop } = useCandidateActions(projectId, candidate);
    const source = candidate.source.title;
    const page = candidate.state === 'joining' ? signInPageOf(candidate.lines) : null;
    const stopButton = (
        <Button variant="secondary" onClick={stop}>
            {t('machines.sources.stop')}
        </Button>
    );
    const startRow = (
        <SettingsRow
            label={t('machines.sources.start.label')}
            description={t('machines.sources.start.description')}
            control={
                <Button variant="secondary" onClick={() => start()}>
                    {t('machines.sources.start.action')}
                </Button>
            }
        />
    );
    let outcome: ReactNode = null;

    if (candidate.state === 'done') {
        outcome = <SettingsRow muted label={t('machines.sources.done.label')} description={t('machines.sources.done.description')} />;
    } else if (candidate.state === 'stopped') {
        outcome = <SettingsRow muted label={t('machines.sources.stopped.label')} description={t('machines.sources.stopped.description')} />;
    } else if (candidate.state === 'failed') {
        outcome = (
            <SettingsRow
                muted
                label={t('machines.sources.failed.label')}
                description={
                    <span className="break-words text-status-error" role="alert">
                        {candidate.failure}
                    </span>
                }
            />
        );
    }

    return (
        <>
            <DetailHeader
                mark={
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-hover">
                        <Icon icon={Container} size={20} className="text-text-muted" />
                    </span>
                }
                title={candidate.title}
                subtitle={t('machines.sources.subtitle', { place: candidate.place, source })}
            />
            <SettingsSection>
                {outcome}
                {candidate.running && !underWay(candidate) && candidate.state !== 'held' && (
                    <SettingsRow muted label={t('machines.sources.running.label')} description={t('machines.sources.running.description')} />
                )}
                {!candidate.running && !underWay(candidate) && candidate.state !== 'held' && startRow}
                {candidate.state === 'preparing' && <SettingsRow label={t('machines.sources.preparing.label', { source })} control={stopButton} />}
                {candidate.state === 'starting' && <SettingsRow label={t('machines.sources.starting.label')} control={stopButton} />}
                {candidate.state === 'joining' && (
                    <SettingsRow
                        label={t('machines.sources.joining.label')}
                        description={
                            <span className="flex min-w-0 flex-col items-start gap-1">
                                <span>{t('machines.sources.joining.description')}</span>
                                {page !== null && (
                                    <a className="text-accent hover:underline" href={page} target="_blank" rel="noreferrer">
                                        {t('machines.sources.joining.open')}
                                    </a>
                                )}
                            </span>
                        }
                        control={stopButton}
                    />
                )}
                {failure !== null && (
                    <SettingsRow
                        muted
                        label={
                            <span className="break-words text-status-error" role="alert">
                                {failure}
                            </span>
                        }
                    />
                )}
            </SettingsSection>
            {candidate.held !== undefined && (
                <SettingsSection title={t('machines.sources.held.title')} description={t('machines.sources.held.description', { source })}>
                    {candidate.held.programs.map((program, index) => (
                        <Program key={index} program={program} />
                    ))}
                    <SettingsRow
                        label={t('machines.sources.held.ask')}
                        control={
                            <span className="flex shrink-0 items-center gap-2">
                                <Button variant="secondary" onClick={stop}>
                                    {t('machines.sources.held.cancel')}
                                </Button>
                                <Button variant="primary" onClick={() => start(candidate.held?.digest)}>
                                    {t('machines.sources.held.approve')}
                                </Button>
                            </span>
                        }
                    />
                </SettingsSection>
            )}
            {candidate.lines.length > 0 && (
                <SettingsSection title={t('machines.sources.log.title')}>
                    <pre className="max-h-80 min-w-0 overflow-auto px-4.5 py-3 font-mono text-xs break-all whitespace-pre-wrap text-text-muted select-text">
                        {candidate.lines.join('\n')}
                    </pre>
                </SettingsSection>
            )}
        </>
    );
}

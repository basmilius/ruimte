import { Button, Icon } from '@adecore/ui';
import { DetailHeader, SettingsRow } from '@adecore/ui/settings';
import type { MachineCandidate, MachineStartProgram } from '@ruimte/contracts';
import { Container } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { underWay, useCandidateActions, useCandidateJoin, type CandidateActions, type CandidateJoin } from '@/machine-ui/machine-candidates';
import { SettingsSection } from '@/machines/SettingsSection';

function Program({ program }: { program: MachineStartProgram }) {
    const { t } = useTranslation('settings');

    return (
        <SettingsRow
            label={program.join === true ? t('machines.sources.held.join') : program.title}
            description={
                <span className="flex min-w-0 flex-col gap-0.5">
                    <code className="font-mono break-all text-text">{program.command}</code>
                    <span className="break-all">{t('machines.sources.held.folder', { folder: program.cwd })}</span>
                </span>
            }
        />
    );
}

interface MachineCandidateDetailProps {
    candidate: MachineCandidate;
    actions: CandidateActions;
    join: CandidateJoin;
    /* Where what is held for a yes was read, when that is no file of the project on screen. */
    heldDescription?: string;
    /* What a joined start says, and what it offers to open on the new machine. */
    joined?: { text: string; open(): void };
}

/* A place an extension of this computer's machine can start a machine in, for the project on screen. */
export function ProjectCandidateDetail({ projectId, candidate }: { projectId: string; candidate: MachineCandidate }) {
    return <MachineCandidateDetail candidate={candidate} actions={useCandidateActions(projectId, candidate)} join={useCandidateJoin(projectId, candidate)} />;
}

/*
 * One place a machine can be started in. A start shows what would run on this computer and waits for a yes, which also
 * says that the new machine comes on the person's account. Once it signed, `join` posts that with the person's session,
 * and this says so when nobody is signed in or the account would not take it.
 */
export function MachineCandidateDetail({ candidate, actions, join, heldDescription, joined }: MachineCandidateDetailProps) {
    const { t } = useTranslation('settings');
    const { failure, start, stop } = actions;
    const source = candidate.source.title;
    const joins = candidate.held?.programs.some((program) => program.join === true) === true;
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
        outcome = (
            <SettingsRow
                muted
                label={t('machines.sources.done.label')}
                description={
                    candidate.join === 'joined' && joined !== undefined
                        ? joined.text
                        : t(candidate.join === 'joined' ? 'machines.sources.done.joined' : 'machines.sources.done.description')
                }
                control={
                    candidate.join === 'joined' && joined !== undefined ? (
                        <Button variant="secondary" onClick={joined.open}>
                            {t('machines.devcontainer.open')}
                        </Button>
                    ) : undefined
                }
            />
        );
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
                {candidate.state === 'joining' && !join.needsSignIn && join.failure === null && (
                    <SettingsRow label={t('machines.sources.joining.label')} control={stopButton} />
                )}
                {join.needsSignIn && (
                    <SettingsRow
                        label={t('machines.sources.joining.signIn.label')}
                        description={t('machines.sources.joining.signIn.description')}
                        control={stopButton}
                    />
                )}
                {join.failure !== null && (
                    <SettingsRow
                        label={t('machines.sources.joining.failed.label')}
                        description={
                            <span className="break-words text-status-error" role="alert">
                                {join.failure}
                            </span>
                        }
                        control={
                            <span className="flex shrink-0 items-center gap-2">
                                {stopButton}
                                <Button variant="secondary" onClick={join.retry}>
                                    {t('machines.sources.joining.failed.retry')}
                                </Button>
                            </span>
                        }
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
                <SettingsSection title={t('machines.sources.held.title')} description={heldDescription ?? t('machines.sources.held.description', { source })}>
                    {candidate.held.programs.map((program, index) => (
                        <Program key={index} program={program} />
                    ))}
                    <SettingsRow
                        label={t('machines.sources.held.ask')}
                        description={joins ? t('machines.sources.held.joins') : undefined}
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

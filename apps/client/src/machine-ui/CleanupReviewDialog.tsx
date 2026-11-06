import { Checkbox, PromptDialog, ScrollArea } from '@adecore/ui';
import { formatBytes, formatDayClock } from '@adecore/ui/format';
import type { ArtifactCleanupProposal } from '@ruimte/contracts';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport/index';

/* One opening of the review. It stays after a close, so the dialog keeps what it showed while it fades out. */
export interface CleanupReview {
    proposal: ArtifactCleanupProposal;
    open: boolean;
    round: number;
}

const NOTHING: ReadonlySet<string> = new Set();
const NO_PROPOSAL: ArtifactCleanupProposal = { id: '', artifactId: '', title: '', versions: [], bytes: 0 };

/*
 * A cleanup proposal as concrete versions, each checked to start with. Only the versions still checked
 * go to the machine, which checks them again; nothing is removed by the proposal itself.
 */
export function CleanupReviewDialog({
    endpointId,
    machine,
    review,
    onClose,
    onRemoved
}: {
    endpointId: string;
    machine: string;
    review: CleanupReview | null;
    onClose(): void;
    onRemoved(): void;
}) {
    const { t } = useTranslation('settings');
    const [left, setLeft] = useState<{ round: number; ids: ReadonlySet<string> }>({ round: 0, ids: new Set() });
    const proposal = review?.proposal ?? NO_PROPOSAL;
    // What a person unchecked holds for one opening; the next starts with every version checked again.
    const unchecked = left.round === review?.round ? left.ids : NOTHING;
    const setUnchecked = (ids: ReadonlySet<string>): void => setLeft({ round: review?.round ?? 0, ids });
    const picked = proposal.versions.filter((version) => !unchecked.has(version.versionId));
    const bytes = picked.reduce((sum, version) => sum + version.bytes, 0);
    const all = picked.length === proposal.versions.length;

    const toggle = (versionId: string): void => {
        const next = new Set(unchecked);
        if (!next.delete(versionId)) {
            next.add(versionId);
        }
        setUnchecked(next);
    };

    const confirm = async (): Promise<void> => {
        const result = await machineTransport(endpointId).request('artifact.cleanup', {
            mode: 'confirm',
            versions: picked.map((version) => ({ artifactId: proposal.artifactId, versionId: version.versionId }))
        });
        useToasts.getState().show({ kind: 'success', title: t('storage.cleanup.freed', { size: formatBytes(result.freedBytes ?? 0), machine }) });
        onRemoved();
    };

    return (
        <PromptDialog
            open={review?.open === true}
            nested
            title={t('storage.cleanup.proposal', { title: proposal.title })}
            description={t('storage.cleanup.dialogDescription', { machine })}
            confirmLabel={t('storage.cleanup.remove', { count: picked.length })}
            confirmIcon={Trash2}
            danger
            confirmDisabled={picked.length === 0}
            fallbackMessage={t('storage.cleanup.failed')}
            onConfirm={confirm}
            onOpenChange={onClose}
        >
            <div className="flex flex-col gap-1">
                <div className="flex h-8 items-center gap-2.5 border-b border-border px-2 text-sm">
                    <Checkbox
                        checked={all}
                        indeterminate={!all && picked.length > 0}
                        label={t('storage.cleanup.all', { count: proposal.versions.length, checked: picked.length })}
                        onCheckedChange={() => setUnchecked(all ? new Set(proposal.versions.map((version) => version.versionId)) : new Set())}
                    />
                    <span className="grow font-medium text-text">{t('storage.cleanup.all', { count: proposal.versions.length, checked: picked.length })}</span>
                    <span className="text-text-muted tabular-nums">{formatBytes(bytes)}</span>
                </div>
                <ScrollArea render={<ul />} className="max-h-72" viewportClassName="flex flex-col">
                    {proposal.versions.map((version) => (
                        <li key={version.versionId}>
                            <div className="flex h-8 items-center gap-2.5 px-2 text-sm">
                                <Checkbox
                                    checked={!unchecked.has(version.versionId)}
                                    label={t('storage.cleanup.version', { number: version.number })}
                                    onCheckedChange={() => toggle(version.versionId)}
                                />
                                <span className="grow text-text tabular-nums">{formatDayClock(version.createdAt)}</span>
                                <span className="text-text-faint tabular-nums">{t('storage.cleanup.version', { number: version.number })}</span>
                                <span className="w-16 text-right text-text-muted tabular-nums">{formatBytes(version.bytes)}</span>
                            </div>
                        </li>
                    ))}
                </ScrollArea>
            </div>
        </PromptDialog>
    );
}

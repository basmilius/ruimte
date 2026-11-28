import { Icon } from '@adecore/ui';
import { MasterItem } from '@adecore/ui/settings';
import type { MachineCandidate } from '@ruimte/contracts';
import { Container } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/* A place an extension can start a machine in, among the machines: no connection dot, since nothing is connected to yet. */
export function MachineCandidateItem({ candidate, selected, onSelect }: { candidate: MachineCandidate; selected: boolean; onSelect(): void }) {
    const { t } = useTranslation('settings');
    const state = candidate.running && candidate.state === 'idle' ? 'running' : candidate.state;

    return (
        <MasterItem selected={selected} onSelect={onSelect}>
            <span className="grid size-7.5 shrink-0 place-items-center rounded-lg bg-surface-hover">
                <Icon icon={Container} size={16} className="text-text-muted" />
            </span>
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{candidate.title}</span>
                <span className="text-xs break-words text-text-muted">{t(`machines.sources.row.${state}`)}</span>
            </span>
        </MasterItem>
    );
}

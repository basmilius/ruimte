import { RUNTIME_MODES, runtimeModeHint, runtimeModeLabel } from '@adecore/agents-react/chat';
import { Checkbox, Field, MiddleTruncate, Segmented, Select, Table } from '@adecore/ui';
import { EXTERNAL_TIERS, type ExternalTier, type RuntimeMode } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import type { Expiry, GrantDraft } from '@/shell/settings/tunnels/grant-draft';
import { useProjectList } from '@/state/project-list';

/* The dialogs are narrower than the smallest breakpoint, so the folder stays and truncates in the middle instead. */
const PROJECT_COLUMNS = [{ width: 'auto' }, { width: 'minmax(0,1fr)' }, { width: 'minmax(0,1fr)' }] as const;

/*
 * What a person decides for a client elsewhere: how far it reaches, which projects, the widest mode of the agents it
 * starts, and whether it may answer approvals. Shown when a bearer is made and when an OAuth client waits for consent.
 */
export function GrantFields({ endpointId, draft, onChange }: { endpointId: string; draft: GrantDraft; onChange: (next: GrantDraft) => void }) {
    const { t } = useTranslation('settings');
    const projects = useProjectList((state) => state.projects).filter((row) => row.endpointId === endpointId);
    const picked = draft.projects;
    const set = (change: Partial<GrantDraft>): void => onChange({ ...draft, ...change });
    const toggled = (id: string, on: boolean): string[] => {
        const kept = (picked ?? []).filter((candidate) => candidate !== id);

        return on ? [...kept, id] : kept;
    };

    return (
        <div className="flex flex-col gap-3">
            <Field orientation="horizontal" label={t('tunnels.grant.tier')} hint={t(`tunnels.grant.tierHint.${draft.tier}`)}>
                <Select<ExternalTier>
                    label={t('tunnels.grant.tier')}
                    variant="outlined"
                    value={draft.tier}
                    items={EXTERNAL_TIERS.map((tier) => ({ value: tier, label: t(`tunnels.tier.${tier}`) }))}
                    onValueChange={(tier) => set({ tier })}
                />
            </Field>
            <Field orientation="horizontal" group label={t('tunnels.grant.projects')}>
                <Segmented<'all' | 'some'>
                    value={draft.projects === null ? 'all' : 'some'}
                    label={t('tunnels.grant.projects')}
                    options={[
                        { id: 'all', label: t('tunnels.grant.allProjects') },
                        { id: 'some', label: t('tunnels.grant.someProjects') }
                    ]}
                    onValueChange={(next) => set({ projects: next === 'all' ? null : [] })}
                />
            </Field>
            {picked !== null && (
                <Table.Root label={t('tunnels.grant.projects')} columns={PROJECT_COLUMNS} density="compact" framed maxHeight={192}>
                    <Table.Head>
                        <Table.Column>
                            <Checkbox
                                label={t('tunnels.grant.pickAll')}
                                checked={projects.length > 0 && picked.length === projects.length}
                                indeterminate={picked.length > 0 && picked.length < projects.length}
                                onCheckedChange={(on) => set({ projects: on ? projects.map((row) => row.summary.projectId) : [] })}
                            />
                        </Table.Column>
                        <Table.Column>{t('tunnels.grant.project')}</Table.Column>
                        <Table.Column>{t('tunnels.grant.folder')}</Table.Column>
                    </Table.Head>
                    {projects.map((row) => {
                        const id = row.summary.projectId;
                        const on = picked.includes(id);

                        return (
                            <Table.Row key={id} selected={on} focusable={false} onClick={() => set({ projects: toggled(id, !on) })}>
                                <Table.Cell>
                                    <Checkbox label={row.summary.name} checked={on} onCheckedChange={(next) => set({ projects: toggled(id, next) })} />
                                </Table.Cell>
                                <Table.Cell>{row.summary.name}</Table.Cell>
                                <Table.Cell mono>
                                    {row.summary.scratch === true ? '' : <MiddleTruncate className="min-w-0" text={row.summary.folder} />}
                                </Table.Cell>
                            </Table.Row>
                        );
                    })}
                </Table.Root>
            )}
            <Field orientation="horizontal" label={t('tunnels.grant.ceiling')}>
                <Select<RuntimeMode>
                    label={t('tunnels.grant.ceiling')}
                    variant="outlined"
                    value={draft.ceiling}
                    items={RUNTIME_MODES.map((mode) => ({ value: mode, label: runtimeModeLabel(mode), description: runtimeModeHint(mode) }))}
                    onValueChange={(ceiling) => set({ ceiling })}
                />
            </Field>
            <Field orientation="horizontal" label={t('tunnels.grant.expiry')}>
                <Select<Expiry>
                    label={t('tunnels.grant.expiry')}
                    variant="outlined"
                    value={draft.expiry}
                    items={(['never', '30', '90', '365'] as const).map((expiry) => ({ value: expiry, label: t(`tunnels.grant.expiryOption.${expiry}`) }))}
                    onValueChange={(expiry) => set({ expiry })}
                />
            </Field>
            <label className="flex items-start gap-2.5">
                <Checkbox label={t('tunnels.grant.approvals')} checked={draft.approvals} onCheckedChange={(approvals) => set({ approvals })} />
                <span className="flex flex-col gap-0.5">
                    <span className="text-text">{t('tunnels.grant.approvals')}</span>
                    <span className="text-xs text-text-muted">{t('tunnels.grant.approvalsWarning')}</span>
                </span>
            </label>
        </div>
    );
}

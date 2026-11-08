import { RUNTIME_MODES, runtimeModeHint, runtimeModeLabel } from '@adecore/agents-react/chat';
import { Checkbox, Field, MiddleTruncate, ScrollArea, Segmented, Select } from '@adecore/ui';
import { EXTERNAL_TIERS, type ExternalTier, type RuntimeMode } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import type { Expiry, GrantDraft } from '@/shell/settings/tunnels/grant-draft';
import { useProjectList } from '@/state/project-list';

/*
 * What a person decides for a client elsewhere: how far it reaches, which projects, the widest mode of the agents it
 * starts, and whether it may answer approvals. Shown when a bearer is made and when an OAuth client waits for consent.
 */
export function GrantFields({ endpointId, draft, onChange }: { endpointId: string; draft: GrantDraft; onChange: (next: GrantDraft) => void }) {
    const { t } = useTranslation('settings');
    const projects = useProjectList((state) => state.projects).filter((row) => row.endpointId === endpointId);
    const set = (change: Partial<GrantDraft>): void => onChange({ ...draft, ...change });
    const toggled = (id: string, on: boolean): string[] => {
        const kept = (draft.projects ?? []).filter((candidate) => candidate !== id);

        return on ? [...kept, id] : kept;
    };

    return (
        <div className="flex flex-col gap-3">
            <Field orientation="horizontal" label={t('tunnels.grant.tier')} hint={t(`tunnels.grant.tierHint.${draft.tier}`)}>
                <Select<ExternalTier>
                    label={t('tunnels.grant.tier')}
                    variant="outlined"
                    value={draft.tier}
                    items={EXTERNAL_TIERS.map((tier) => ({ value: tier, label: t(`tunnels.credentials.tier.${tier}`) }))}
                    onValueChange={(tier) => set({ tier })}
                />
            </Field>
            <Field orientation="horizontal" label={t('tunnels.grant.projects')}>
                <div className="flex flex-col gap-1.5">
                    <Segmented<'all' | 'some'>
                        value={draft.projects === null ? 'all' : 'some'}
                        label={t('tunnels.grant.projects')}
                        options={[
                            { id: 'all', label: t('tunnels.grant.allProjects') },
                            { id: 'some', label: t('tunnels.grant.someProjects') }
                        ]}
                        onValueChange={(next) => set({ projects: next === 'all' ? null : [] })}
                    />
                    {draft.projects !== null && (
                        <ScrollArea
                            render={<ul />}
                            className="max-h-48 overflow-hidden rounded-md border border-border"
                            viewportClassName="divide-y divide-border"
                            aria-label={t('tunnels.grant.projects')}
                        >
                            {projects.map((row) => (
                                <li key={row.summary.projectId}>
                                    <label className="flex min-h-8 min-w-0 items-center gap-2.5 px-2.5 py-1.5">
                                        <Checkbox
                                            label={row.summary.name}
                                            checked={draft.projects?.includes(row.summary.projectId) === true}
                                            onCheckedChange={(on) => set({ projects: toggled(row.summary.projectId, on) })}
                                        />
                                        <span className="flex min-w-0 flex-col">
                                            <span className="truncate text-sm text-text">{row.summary.name}</span>
                                            {row.summary.scratch !== true && <MiddleTruncate className="text-xs text-text-muted" text={row.summary.folder} />}
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ScrollArea>
                    )}
                </div>
            </Field>
            <Field orientation="horizontal" label={t('tunnels.grant.ceiling')} hint={t('tunnels.grant.ceilingHint')}>
                <Select<RuntimeMode>
                    label={t('tunnels.grant.ceiling')}
                    variant="outlined"
                    value={draft.ceiling}
                    items={RUNTIME_MODES.map((mode) => ({ value: mode, label: runtimeModeLabel(mode), description: runtimeModeHint(mode) }))}
                    onValueChange={(ceiling) => set({ ceiling })}
                />
            </Field>
            <Field orientation="horizontal" label={t('tunnels.grant.expiry')} hint={t('tunnels.grant.expiryHint')}>
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

import { ModelPicker } from '@adecore/agents-react/chat/ui';
import { useProviders } from '@adecore/agents-react/state';
import { Dialog, Field, FormError, Input } from '@adecore/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { submitOnEnter } from '@/surface/submit-on-enter';
import type { WorktreeStart } from '@/worktrees/use-worktree-start';

export function WorktreeStartFields({ start, idPrefix, onSubmit }: { start: WorktreeStart; idPrefix: string; onSubmit(): void }) {
    const { t } = useTranslation('shell');
    const providers = useProviders((s) => s.providers);
    const pickable = providers.filter((entry) => entry.installed && entry.capabilities.chat);
    const [pickerOpen, setPickerOpen] = useState(false);
    const keys = submitOnEnter(onSubmit);
    const baseMissing = start.commit === 'missing';
    const baseHint =
        start.base.trim() === ''
            ? t('newWorktreeChat.baseEmpty')
            : start.commit === 'missing'
              ? undefined
              : start.baseKnown && start.commit !== null
                ? t('newWorktreeChat.baseCommit', { commit: start.commit.commit.slice(0, 7), subject: start.commit.subject })
                : t('newWorktreeChat.baseLooking');
    return (
        <>
            {start.refsFailure !== null && <FormError className="mt-3 break-words">{start.refsFailure}</FormError>}
            {pickable.length === 0 && <Dialog.Text className="mt-3">{t('newWorktreeChat.noProvider')}</Dialog.Text>}
            <Field
                label={t('newWorktreeChat.branchLabel')}
                error={start.branchProblem}
                hint={start.reuses ? t('newWorktreeChat.reusesWorktree') : undefined}
                className="mt-3"
            >
                <Input mono value={start.branch} spellCheck={false} onChange={(e) => start.setBranch(e.target.value)} onKeyDown={keys} />
            </Field>
            {!start.reuses && (
                <Field
                    label={t('newWorktreeChat.baseLabel')}
                    hint={baseHint}
                    error={baseMissing && start.base.trim() !== '' ? t('newWorktreeChat.baseMissing') : undefined}
                    className="mt-3"
                >
                    <Input
                        mono
                        className="[&::-webkit-calendar-picker-indicator]:hidden"
                        list={`${idPrefix}-refs`}
                        value={start.base}
                        spellCheck={false}
                        onChange={(e) => start.setBase(e.target.value)}
                        onKeyDown={keys}
                    />
                    <datalist id={`${idPrefix}-refs`}>
                        {(start.refs?.refs ?? []).map((ref) => (
                            <option key={`${ref.kind}:${ref.name}`} value={ref.name} />
                        ))}
                    </datalist>
                </Field>
            )}
            {start.provider !== null && start.selection !== null && pickable.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-text">{t('newWorktreeChat.model')}</span>
                    <ModelPicker
                        providers={pickable}
                        provider={start.provider}
                        selection={start.selection}
                        open={pickerOpen}
                        onOpenChange={setPickerOpen}
                        onChange={(provider, model) => start.pickProvider(provider, { model, options: {} })}
                    />
                </div>
            )}
        </>
    );
}

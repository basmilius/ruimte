import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Lock, LockOpen, Plus, X } from 'lucide-react';
import type { ProviderAccount } from '@ruimte/contracts';
import { saveAccount } from '@/shell/settings/providers/account-actions';
import { draftsOf, emptyDraft, variablesChanged, variablesOf, variablesProblem, type VariableDraft } from '@/shell/settings/providers/variables';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Button } from '@ruimte/ui/Button';
import { FORM_ERROR } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';

interface AccountVariablesProps {
    endpointId: string;
    id: string;
    account: ProviderAccount;
    /* Whether the machine has a keychain to keep a sensitive value in. */
    secretsAvailable: boolean;
}

/*
 * The environment of one account, edited as a whole and saved with one button: a half-typed name or a
 * secret that still has to be retyped would otherwise reach the machine one keystroke at a time.
 */
export function AccountVariables({ endpointId, id, account, secretsAvailable }: AccountVariablesProps) {
    const { t } = useTranslation('settings');
    const [drafts, setDrafts] = useState<VariableDraft[]>(() => draftsOf(account.env));
    const [saving, setSaving] = useState(false);
    const changed = variablesChanged(drafts, account.env);
    const problem = changed ? variablesProblem(drafts) : null;

    const update = (key: string, patch: Partial<VariableDraft>): void => {
        setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
    };

    const save = async (): Promise<void> => {
        const env = variablesOf(drafts);
        const { env: _env, ...rest } = account;
        setSaving(true);
        try {
            await saveAccount(endpointId, id, env.length === 0 ? rest : { ...rest, env });
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsSection
            title={t('providers.account.variables.title')}
            description={t('providers.account.variables.description')}
            action={
                <Button variant="secondary" size="sm" onClick={() => setDrafts((current) => [...current, emptyDraft(false)])}>
                    <Icon icon={Plus} size={14} />
                    {t('providers.account.variables.add')}
                </Button>
            }
            footer={secretsAvailable ? undefined : t('providers.account.variables.noKeychain')}
        >
            {drafts.length === 0 && <SettingsRow muted label={t('providers.account.variables.none')} />}
            {drafts.map((draft, index) => {
                const name = draft.name.trim() || String(index + 1);
                const kept = draft.value === '' && draft.sensitive && draft.kept === draft.name.trim();
                const lockLabel = draft.sensitive ? t('providers.account.variables.unlock', { name }) : t('providers.account.variables.lock', { name });
                // Off a keychain a value can only be made plain, never secret.
                const lockDisabled = !secretsAvailable && !draft.sensitive;
                return (
                    <div key={draft.key} className="flex min-w-0 items-center gap-2 px-3.5 py-3 font-mono text-code">
                        <input
                            className="field h-7.5 w-47.5 shrink-0 font-mono text-code max-[640px]:w-32"
                            value={draft.name}
                            spellCheck={false}
                            autoComplete="off"
                            aria-label={t('providers.account.variables.name', { index: index + 1 })}
                            placeholder="NAME"
                            onChange={(event) => update(draft.key, { name: event.target.value })}
                        />
                        <span className="text-text-faint">=</span>
                        <input
                            className="field h-7.5 min-w-0 grow font-mono text-code"
                            type={draft.sensitive ? 'password' : 'text'}
                            value={draft.value}
                            spellCheck={false}
                            autoComplete="off"
                            aria-label={t('providers.account.variables.value', { name })}
                            placeholder={kept ? t('providers.account.variables.kept') : undefined}
                            onChange={(event) => update(draft.key, { value: event.target.value })}
                        />
                        <Tooltip label={lockDisabled ? t('providers.account.variables.noKeychain') : lockLabel}>
                            <span className="inline-flex">
                                <button
                                    type="button"
                                    className={clsx('icon-btn icon-btn-sm', draft.sensitive && 'text-text')}
                                    aria-label={lockLabel}
                                    aria-pressed={draft.sensitive}
                                    disabled={lockDisabled}
                                    onClick={() => update(draft.key, { sensitive: !draft.sensitive })}
                                >
                                    <Icon icon={draft.sensitive ? Lock : LockOpen} size={14} />
                                </button>
                            </span>
                        </Tooltip>
                        <Tooltip label={t('providers.account.variables.remove', { name })} name>
                            <button
                                type="button"
                                className="icon-btn icon-btn-sm"
                                onClick={() => setDrafts((current) => current.filter((other) => other.key !== draft.key))}
                            >
                                <Icon icon={X} size={14} />
                            </button>
                        </Tooltip>
                    </div>
                );
            })}
            {changed && (
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 px-4.5 py-3">
                    {problem !== null && (
                        <span className={clsx(FORM_ERROR, 'mr-auto')} role="alert">
                            {problem}
                        </span>
                    )}
                    <Button onClick={() => setDrafts(draftsOf(account.env))}>{t('providers.account.variables.discard')}</Button>
                    <Button variant="primary" disabled={problem !== null || saving} onClick={() => void save()}>
                        {t('common:action.save')}
                    </Button>
                </div>
            )}
        </SettingsSection>
    );
}

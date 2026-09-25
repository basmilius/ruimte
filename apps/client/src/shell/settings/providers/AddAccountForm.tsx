import { useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { ProviderInfo } from '@ruimte/contracts';
import { freeAccountColor, mintAccountId, type AccountEntry } from '@/agents/accounts';
import { createAccount, linkAccount } from '@/shell/settings/providers/account-actions';
import { CliTile, ColorSwatches, DetailHeader } from '@/shell/settings/providers/parts';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { providerAccountsOf } from '@/state/provider-accounts';
import { Button } from '@/ui/Button';
import { FORM_ERROR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

interface AddAccountFormProps {
    endpointId: string;
    provider: ProviderInfo;
    entries: AccountEntry[];
    onCancel(): void;
    /* The account exists; `made` says the machine made its folder, so nobody signed in there yet. */
    onAdded(id: string, name: string, made: boolean): void;
}

/*
 * A name and a color, asked before anything exists, so the account is made once with both. By default
 * the machine makes the folder; under Advanced a person points at a folder of their own instead.
 */
export function AddAccountForm({ endpointId, provider, entries, onCancel, onAdded }: AddAccountFormProps) {
    const { t } = useTranslation('settings');
    const [name, setName] = useState('');
    const [color, setColor] = useState<string>(() => freeAccountColor(entries));
    const [advanced, setAdvanced] = useState(false);
    const [folder, setFolder] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const label = name.trim();
    const linking = advanced && folder.trim() !== '';

    const submit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        if (label === '' || busy) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            if (linking) {
                const taken = new Set(Object.keys(providerAccountsOf(endpointId).accounts?.accounts ?? {}));
                const id = mintAccountId(provider.kind, label, taken);
                await linkAccount(endpointId, id, { kind: provider.kind, label, color, home: folder.trim() });
                onAdded(id, label, false);
            } else {
                onAdded(await createAccount(endpointId, provider.kind, label, color), label, true);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    };

    return (
        <form className="contents" onSubmit={(event) => void submit(event)}>
            <DetailHeader
                mark={<CliTile kind={provider.kind} />}
                title={t('providers.add.title', { provider: provider.name })}
                subtitle={t('providers.add.description')}
            />
            <SettingsSection>
                <SettingsRow
                    label={t('providers.add.name')}
                    control={
                        <input
                            className="field w-55 max-w-full"
                            value={name}
                            maxLength={80}
                            autoFocus
                            placeholder={t('providers.add.namePlaceholder')}
                            aria-label={t('providers.add.name')}
                            onChange={(event) => setName(event.target.value)}
                        />
                    }
                />
                <SettingsRow label={t('providers.add.color')} control={<ColorSwatches value={color} label={t('providers.add.color')} onChange={setColor} />} />
            </SettingsSection>
            <div className="flex min-w-0 flex-col gap-2.5">
                <button
                    type="button"
                    aria-expanded={advanced}
                    className="flex items-center gap-1.5 self-start text-sm font-medium text-text-muted hover:text-text"
                    onClick={() => setAdvanced((open) => !open)}
                >
                    <Icon icon={ChevronRight} size={14} className={clsx('transition-transform', advanced && 'rotate-90')} />
                    {t('providers.add.advanced')}
                </button>
                {advanced && (
                    <SettingsSection>
                        <SettingsRow label={t('providers.add.link.label')} description={t('providers.add.link.description')}>
                            <input
                                className="field font-mono text-code"
                                value={folder}
                                spellCheck={false}
                                autoComplete="off"
                                placeholder={t('providers.add.link.placeholder')}
                                aria-label={t('providers.add.link.label')}
                                onChange={(event) => setFolder(event.target.value)}
                            />
                        </SettingsRow>
                    </SettingsSection>
                )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                {error !== null && (
                    <span className={clsx(FORM_ERROR, 'mr-auto break-words')} role="alert">
                        {error || t('providers.add.failed')}
                    </span>
                )}
                <Button onClick={onCancel}>{t('common:action.cancel')}</Button>
                <Button type="submit" variant="primary" disabled={label === '' || busy}>
                    {linking ? t('providers.add.linkButton') : t('providers.add.create')}
                </Button>
            </div>
        </form>
    );
}

import { useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { ProviderInfo } from '@ruimte/agent-contracts';
import { freeAccountColor, mintAccountId, type AccountEntry } from '../agents/accounts';
import { chatHost } from '../host';
import { useChatScope } from '../scope';
import { createAccount, linkAccount } from './account-actions';
import { AccountColors } from './AccountColors';
import { DetailHeader } from '@ruimte/ui/settings/DetailHeader';
import { CliTile } from './parts';
import { SettingsRow } from '@ruimte/ui/settings/SettingsRow';
import { SettingsSection } from '@ruimte/ui/settings/SettingsSection';
import { providerAccountsOf } from '../state/provider-accounts';
import { Button } from '@ruimte/ui/Button';
import { FORM_ERROR } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';

interface AddAccountFormProps {
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
export function AddAccountForm({ provider, entries, onCancel, onAdded }: AddAccountFormProps) {
    const { t } = useTranslation('agent-providers');
    const scope = useChatScope();
    const [name, setName] = useState('');
    const [color, setColor] = useState<string>(() => freeAccountColor(entries, chatHost().accents.current()));
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
                const taken = new Set(Object.keys(providerAccountsOf(scope.id).accounts?.accounts ?? {}));
                const id = mintAccountId(provider.kind, label, taken);
                await linkAccount(scope, id, { kind: provider.kind, label, color, home: folder.trim() });
                onAdded(id, label, false);
            } else {
                onAdded(await createAccount(scope, provider.kind, label, color), label, true);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    };

    return (
        <form className="contents" onSubmit={(event) => void submit(event)}>
            <DetailHeader mark={<CliTile kind={provider.kind} />} title={t('add.title', { provider: provider.name })} subtitle={t('add.description')} />
            <SettingsSection>
                <SettingsRow
                    label={t('add.name')}
                    control={
                        <input
                            className="field w-55 max-w-full"
                            value={name}
                            maxLength={80}
                            autoFocus
                            placeholder={t('add.namePlaceholder')}
                            aria-label={t('add.name')}
                            onChange={(event) => setName(event.target.value)}
                        />
                    }
                />
                <SettingsRow label={t('add.color')} control={<AccountColors value={color} label={t('add.color')} onChange={setColor} />} />
            </SettingsSection>
            <div className="flex min-w-0 flex-col gap-2.5">
                <button
                    type="button"
                    aria-expanded={advanced}
                    className="flex items-center gap-1.5 self-start text-sm font-medium text-text-muted hover:text-text"
                    onClick={() => setAdvanced((open) => !open)}
                >
                    <Icon icon={ChevronRight} size={14} className={clsx('transition-transform', advanced && 'rotate-90')} />
                    {t('add.advanced')}
                </button>
                {advanced && (
                    <SettingsSection>
                        <SettingsRow label={t('add.link.label')} description={t('add.link.description')}>
                            <input
                                className="field font-mono text-code"
                                value={folder}
                                spellCheck={false}
                                autoComplete="off"
                                placeholder={t('add.link.placeholder')}
                                aria-label={t('add.link.label')}
                                onChange={(event) => setFolder(event.target.value)}
                            />
                        </SettingsRow>
                    </SettingsSection>
                )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                {error !== null && (
                    <span className={clsx(FORM_ERROR, 'mr-auto break-words')} role="alert">
                        {error || t('add.failed')}
                    </span>
                )}
                <Button onClick={onCancel}>{t('common.cancel')}</Button>
                <Button type="submit" variant="primary" disabled={label === '' || busy}>
                    {linking ? t('add.linkButton') : t('add.create')}
                </Button>
            </div>
        </form>
    );
}

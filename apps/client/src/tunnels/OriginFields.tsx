import { Checkbox, Field, Icon, Input, Segmented } from '@adecore/ui';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OriginDraft } from '@/tunnels/origin-draft';

/* How Cloudflare talks to a dev server, behind a disclosure: most servers need none of it. */
export function OriginFields({
    draft,
    initiallyOpen,
    disabled,
    onChange
}: {
    draft: OriginDraft;
    initiallyOpen: boolean;
    disabled?: boolean;
    onChange: (draft: OriginDraft) => void;
}) {
    const { t } = useTranslation('settings');
    const [open, setOpen] = useState(initiallyOpen);

    return (
        <div className="flex flex-col gap-3">
            <button
                type="button"
                className="flex items-center gap-1 self-start text-sm text-text-muted hover:text-text"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                <Icon icon={ChevronRight} size={14} className={clsx('transition-transform', open && 'rotate-90')} />
                {t('tunnels.origin.advanced')}
            </button>
            {open && (
                <>
                    <Field orientation="horizontal" group label={t('tunnels.origin.protocol')}>
                        <Segmented
                            value={draft.https ? 'https' : 'http'}
                            label={t('tunnels.origin.protocol')}
                            options={[
                                { id: 'http', label: 'HTTP' },
                                { id: 'https', label: 'HTTPS' }
                            ]}
                            disabled={disabled}
                            onValueChange={(protocol) => onChange({ ...draft, https: protocol === 'https' })}
                        />
                    </Field>
                    <Field orientation="horizontal" label={t('tunnels.origin.hostHeader')} hint={t('tunnels.origin.hostHeaderHint')}>
                        <Input
                            aria-label={t('tunnels.origin.hostHeader')}
                            spellCheck={false}
                            placeholder="passly.test"
                            value={draft.hostHeader}
                            onChange={(e) => onChange({ ...draft, hostHeader: e.target.value })}
                        />
                    </Field>
                    {draft.https && (
                        <>
                            <label className="flex items-start gap-2.5">
                                <Checkbox
                                    label={t('tunnels.origin.noTlsVerify')}
                                    checked={draft.noTlsVerify}
                                    disabled={disabled}
                                    onCheckedChange={(noTlsVerify) => onChange({ ...draft, noTlsVerify })}
                                />
                                <span className="flex flex-col gap-0.5">
                                    <span className="text-text">{t('tunnels.origin.noTlsVerify')}</span>
                                    <span className="text-xs text-text-muted">{t('tunnels.origin.noTlsVerifyHint')}</span>
                                </span>
                            </label>
                            <Field orientation="horizontal" label={t('tunnels.origin.serverName')}>
                                <Input
                                    aria-label={t('tunnels.origin.serverName')}
                                    spellCheck={false}
                                    placeholder="passly.test"
                                    value={draft.serverName}
                                    onChange={(e) => onChange({ ...draft, serverName: e.target.value })}
                                />
                            </Field>
                        </>
                    )}
                </>
            )}
        </div>
    );
}

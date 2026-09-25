import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MasterDetail, MasterItem } from '@/shell/settings/MasterDetail';
import { providerAbilities } from '@/shell/settings/provider-abilities';
import { sectionLabel } from '@/shell/settings/sections';
import { useProviders } from '@/state/providers';

/* The agent CLIs of the machine, one at a time. A first cut: the accounts of each CLI join it here. */
export function ProvidersPane() {
    const { t } = useTranslation('settings');
    const providers = useProviders((s) => s.providers);
    const [picked, setPicked] = useState<string | null>(null);
    const selected = providers.find((provider) => provider.kind === picked) ?? providers[0] ?? null;

    return (
        <MasterDetail
            listWidth={340}
            listLabel={sectionLabel('providers')}
            list={providers.map((provider) => (
                <MasterItem key={provider.kind} selected={provider === selected} onSelect={() => setPicked(provider.kind)}>
                    <span className="min-w-0 grow truncate">{provider.name}</span>
                    {provider.version && <span className="shrink-0 font-mono text-code text-text-faint">{provider.version}</span>}
                </MasterItem>
            ))}
            detail={
                selected === null ? (
                    <p className="text-xs text-text-muted">{t('agents.providers.none')}</p>
                ) : (
                    <header className="flex min-w-0 flex-col gap-0.5">
                        <h3 className="text-lg font-semibold text-text">{selected.name}</h3>
                        <p className="text-xs text-text-muted">
                            {selected.installed
                                ? `${selected.version ? `${t('agents.providers.version', { version: selected.version })} ` : ''}${providerAbilities(selected)}`
                                : t('agents.providers.missing')}
                        </p>
                    </header>
                )
            }
        />
    );
}

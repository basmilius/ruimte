import { ChevronRight, Bot, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderInfo } from '@ruimte/contracts';
import { AgentIcon } from '@ruimte/agents-react/agents/AgentIcon';
import { modelName } from '@ruimte/agents-react/agents/model-name';
import { startingSelection, useChatPreferences } from '@ruimte/agents-react/chat/preferences';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { Icon, SectionLabel } from '@basmilius/desktop-ui';
import { availableAgents } from './creation';
import { useUi } from '@/state/ui';

export function ProviderRows({ onPick }: { onPick(provider: ProviderInfo): void }) {
    const { t } = useTranslation('agents');
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const preferences = useChatPreferences();
    const agents = availableAgents(providers, 'chat');
    return (
        <section className="flex flex-col gap-2">
            <SectionLabel render={<h2 />} className="px-1">
                {t('menu.newChat')}
            </SectionLabel>
            <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
                {agents.map((provider) => {
                    const model = startingSelection(preferences, provider)?.model ?? null;
                    return (
                        <button
                            key={provider.kind}
                            type="button"
                            className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                            onClick={() => onPick(provider)}
                        >
                            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface">
                                <AgentIcon kind={provider.kind} size={20} className={provider.kind === 'claude' ? 'text-chart-claude' : undefined} />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                                <span className="max-w-full text-sm font-medium break-words text-text">{provider.name}</span>
                                <span className="truncate text-xs text-text-muted">
                                    {model === null ? t('menu.defaultModel') : modelName(model, provider.models)}
                                </span>
                            </span>
                            <Icon icon={ChevronRight} size={16} className="shrink-0 text-text-faint" />
                        </button>
                    );
                })}
                {agents.length === 0 && (
                    <button
                        type="button"
                        disabled={!loaded}
                        onClick={() => useUi.getState().setSettings({ open: true, section: 'agents' })}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-text-muted hover:bg-surface-hover disabled:cursor-default"
                    >
                        <Icon icon={loaded ? Bot : LoaderCircle} size={20} className={loaded ? undefined : 'animate-spin'} />
                        {loaded ? t('menu.setup') : t('menu.connecting')}
                    </button>
                )}
            </div>
        </section>
    );
}

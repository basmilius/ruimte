import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PackagePlus, RefreshCw, Search } from 'lucide-react';
import { registryAgentMatches, type AgentKind, type RegistryAgent } from '@ruimte/contracts';
import { CliMark } from '@adecore/agents-react/providers';
import { Button, EmptyState, Icon, IconButton, Input, Skeleton, Spinner } from '@adecore/ui';
import { formatMoment } from '@adecore/ui/format';
import { DetailHeader, SettingsRow } from '@adecore/ui/settings';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import type { RegistryCatalogState } from '@/shell/settings/providers/use-provider-installs';

function AgentControl({ agent, registry, onOpen }: { agent: RegistryAgent; registry: RegistryCatalogState; onOpen(kind: AgentKind): void }) {
    const { t } = useTranslation('settings');
    if (agent.state === 'installing') {
        return <Spinner size={12} />;
    }
    if (agent.installed !== null && agent.installed === agent.version) {
        return (
            <Button size="sm" variant="ghost" onClick={() => onOpen(agent.kind)}>
                {t('providers.registry.open')}
            </Button>
        );
    }
    return (
        <Button size="sm" variant="secondary" disabled={!registry.local} onClick={() => void registry.install(agent.id)}>
            {agent.installed === null ? t('providers.registry.install') : t('providers.registry.update', { version: agent.version })}
        </Button>
    );
}

function AgentRow({ agent, registry, onOpen }: { agent: RegistryAgent; registry: RegistryCatalogState; onOpen(kind: AgentKind): void }) {
    const { t } = useTranslation('settings');
    const facts = [
        t('providers.registry.version', { version: agent.installed ?? agent.version }),
        ...(agent.checksum ? [t('providers.registry.checksum')] : [])
    ].join(' · ');
    return (
        <SettingsRow
            leading={<CliMark kind={agent.kind} />}
            label={agent.name}
            description={
                <>
                    {agent.description !== '' && <span className="block">{agent.description}</span>}
                    <span className="block text-text-faint">{facts}</span>
                    {agent.state === 'failed' && agent.error && <span className="block text-status-needs-you">{agent.error}</span>}
                </>
            }
            control={<AgentControl agent={agent} registry={registry} onOpen={onOpen} />}
        />
    );
}

/*
 * The page to add a provider from: every agent of the ACP registry with a build or package for the machine, searchable,
 * the whole catalog shown without a search. An Install is a person's, and only the app on the machine itself may press it.
 */
export function RegistryCatalogPage({ registry, onOpen }: { registry: RegistryCatalogState; onOpen(kind: AgentKind): void }) {
    const { t } = useTranslation('settings');
    const [search, setSearch] = useState('');
    const catalog = registry.catalog;
    const agents = catalog?.agents.filter((agent) => registryAgentMatches(agent, search)) ?? [];

    const body = (() => {
        if (catalog === null && registry.error === null) {
            return (
                <SettingsSection title={t('providers.registry.listTitle')}>
                    {[0, 1, 2].map((row) => (
                        <div key={row} className="flex flex-col gap-2 px-4.5 py-3">
                            <Skeleton className="w-32" />
                            <Skeleton className="w-64" />
                        </div>
                    ))}
                </SettingsSection>
            );
        }
        if (catalog === null || catalog.source === 'unavailable') {
            return (
                <EmptyState
                    icon={PackagePlus}
                    title={t('providers.registry.unavailable')}
                    action={
                        <Button variant="secondary" onClick={registry.refresh}>
                            {t('providers.registry.tryAgain')}
                        </Button>
                    }
                >
                    {registry.error ?? catalog?.error ?? ''}
                </EmptyState>
            );
        }
        if (catalog.agents.length === 0) {
            return <EmptyState icon={PackagePlus}>{t('providers.registry.empty')}</EmptyState>;
        }
        return (
            <SettingsSection
                title={t('providers.registry.listTitle')}
                description={t('providers.registry.listDescription')}
                scope="machine"
                footer={registry.local ? undefined : t('providers.registry.localOnly')}
            >
                {agents.map((agent) => (
                    <AgentRow key={agent.id} agent={agent} registry={registry} onOpen={onOpen} />
                ))}
                {agents.length === 0 && <SettingsRow muted label={t('providers.registry.noMatch', { search: search.trim() })} />}
            </SettingsSection>
        );
    })();

    return (
        <>
            <DetailHeader
                mark={
                    <span className="grid h-6 shrink-0 place-items-center text-text-muted">
                        <Icon icon={PackagePlus} size={20} />
                    </span>
                }
                title={t('providers.registry.title')}
                subtitle={t('providers.registry.subtitle')}
                actions={
                    registry.loading && catalog !== null ? (
                        <Spinner size={14} />
                    ) : (
                        <IconButton icon={RefreshCw} label={t('providers.registry.refresh')} onClick={registry.refresh} />
                    )
                }
            />
            {catalog?.source === 'cached' && (
                <p className="text-xs text-text-muted">
                    {t('providers.registry.cached', { error: catalog.error ?? '', date: catalog.fetchedAt === null ? '' : formatMoment(catalog.fetchedAt) })}
                </p>
            )}
            {catalog !== null && catalog.agents.length > 0 && (
                <Input
                    icon={Search}
                    value={search}
                    placeholder={t('providers.registry.search')}
                    aria-label={t('providers.registry.search')}
                    onChange={(event) => setSearch(event.target.value)}
                />
            )}
            {body}
        </>
    );
}

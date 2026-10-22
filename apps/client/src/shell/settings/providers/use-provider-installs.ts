import { useEffect, useState } from 'react';
import type { AgentKind, CliVersion, RegistryAgent, RegistryCatalog } from '@ruimte/contracts';
import { useProvidersStore } from '@adecore/agents-react/state';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { useMachineAnswers } from '@/transport/features';

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/* The provider list again, so a provider a person just installed, updated or removed shows at once. */
async function listProvidersAgain(endpointId: string): Promise<void> {
    const link = transportFor(endpointId);
    if (link) {
        const { providers } = await link.request('provider.list', {});
        useProvidersStore.getState().setProviders(endpointId, providers);
    }
}

export interface RegistryCatalogState {
    /* False on a machine that answers no `provider.registry`, which then has no page to add a provider from. */
    answers: boolean;
    /* Null while the machine has not answered yet. */
    catalog: RegistryCatalog | null;
    /* While a person's refresh is on its way; the first read shows as a catalog that is still null. */
    loading: boolean;
    /* Why the machine did not answer at all. */
    error: string | null;
    /* Only the app on the machine itself may install, since that downloads a program and makes it runnable there. */
    local: boolean;
    refresh(): void;
    install(id: string): Promise<RegistryAgent | null>;
}

/* The agents of the ACP registry a machine can run, and a person's Install of one. */
export function useRegistryCatalog(endpointId: string): RegistryCatalogState {
    const answers = useMachineAnswers(endpointId, 'provider.registry');
    const [catalog, setCatalog] = useState<RegistryCatalog | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [asked, setAsked] = useState(0);

    useEffect(() => {
        const link = transportFor(endpointId);
        if (!link || !answers) {
            return;
        }
        let live = true;
        link.request('provider.registry', { refresh: asked > 0 }).then(
            (result) => {
                if (live) {
                    setCatalog(result.catalog);
                    setLoading(false);
                }
            },
            (e: unknown) => {
                if (live) {
                    setError(messageOf(e));
                    setLoading(false);
                }
            }
        );
        return () => {
            live = false;
        };
    }, [endpointId, answers, asked]);

    const place = (agent: RegistryAgent): void => {
        setCatalog((current) => current && { ...current, agents: current.agents.map((entry) => (entry.id === agent.id ? agent : entry)) });
    };

    async function install(id: string): Promise<RegistryAgent | null> {
        const link = transportFor(endpointId);
        const agent = catalog?.agents.find((entry) => entry.id === id);
        if (!link || agent === undefined) {
            return null;
        }
        place({ ...agent, state: 'installing' });
        try {
            const result = await link.request('provider.installAgent', { id });
            place(result.agent);
            if (result.agent.state === 'installed') {
                await listProvidersAgain(endpointId);
            }
            return result.agent;
        } catch (e) {
            place({ ...agent, state: 'failed', error: messageOf(e) });
            return null;
        }
    }

    return {
        answers,
        catalog: answers ? catalog : null,
        loading,
        error,
        local: endpointId === LOCAL_ENDPOINT_ID,
        refresh: () => {
            setLoading(true);
            setError(null);
            setAsked((count) => count + 1);
        },
        install
    };
}

export interface CliVersionsState {
    /* False on a machine that answers no `provider.versions`, which then shows no version section. */
    answers: boolean;
    versionOf(kind: AgentKind): CliVersion | null;
    checking: ReadonlySet<AgentKind>;
    local: boolean;
    check(kind: AgentKind): Promise<void>;
    update(kind: AgentKind): Promise<void>;
    /* Takes an agent a person installed from the registry off the machine. */
    remove(kind: AgentKind): Promise<void>;
}

/* The version of each CLI on a machine, how it was installed, and a person's update through that same route. */
export function useCliVersions(endpointId: string): CliVersionsState {
    const answers = useMachineAnswers(endpointId, 'provider.versions');
    const [versions, setVersions] = useState<CliVersion[]>([]);
    const [checking, setChecking] = useState<ReadonlySet<AgentKind>>(new Set());

    useEffect(() => {
        const link = transportFor(endpointId);
        if (!link || !answers) {
            return;
        }
        let live = true;
        link.request('provider.versions', {}).then(
            (result) => {
                if (live) {
                    setVersions(result.versions);
                }
            },
            // Without an answer the detail simply has no version section.
            () => undefined
        );
        return () => {
            live = false;
        };
    }, [endpointId, answers]);

    const place = (version: CliVersion): void => {
        setVersions((current) => [...current.filter((entry) => entry.provider !== version.provider), version]);
    };
    const marking = (kind: AgentKind, on: boolean): void => {
        setChecking((current) => {
            const next = new Set(current);
            if (on) {
                next.add(kind);
            } else {
                next.delete(kind);
            }
            return next;
        });
    };
    const versionOf = (kind: AgentKind): CliVersion | null => versions.find((entry) => entry.provider === kind) ?? null;

    async function check(kind: AgentKind): Promise<void> {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        marking(kind, true);
        try {
            const [version] = (await link.request('provider.versions', { provider: kind, refresh: true })).versions;
            if (version) {
                place(version);
            }
        } catch (e) {
            const known = versionOf(kind);
            if (known) {
                place({ ...known, error: messageOf(e) });
            }
        } finally {
            marking(kind, false);
        }
    }

    async function update(kind: AgentKind): Promise<void> {
        const link = transportFor(endpointId);
        const known = versionOf(kind);
        if (!link || known === null) {
            return;
        }
        place({ ...known, state: 'updating' });
        try {
            place((await link.request('provider.update', { provider: kind })).version);
            await listProvidersAgain(endpointId);
        } catch (e) {
            place({ ...known, state: 'failed', error: messageOf(e) });
        }
    }

    async function remove(kind: AgentKind): Promise<void> {
        const link = transportFor(endpointId);
        const known = versionOf(kind);
        if (!link || known === null) {
            return;
        }
        try {
            await link.request('provider.removeAgent', { id: kind });
            setVersions((current) => current.filter((entry) => entry.provider !== kind));
            await listProvidersAgain(endpointId);
        } catch (e) {
            place({ ...known, state: 'failed', error: messageOf(e) });
        }
    }

    return { answers, versionOf, checking, local: endpointId === LOCAL_ENDPOINT_ID, check, update, remove };
}

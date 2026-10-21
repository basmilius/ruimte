import type { AgentIntegration, AgentIntegrationFile, AgentIntegrationReport, AgentIntegrationsSummary, AgentKind } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { serverInfoOf, useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';

/* The CLIs' own names, which no language translates. */
export const INTEGRATION_NAMES: Partial<Record<AgentKind, string>> = {
    claude: 'Claude Code',
    codex: 'Codex',
    antigravity: 'Antigravity',
    copilot: 'GitHub Copilot',
    grok: 'Grok'
};

/*
 * Whether a person still has something to decide: a provider never asked about, or one that was
 * wired up by an earlier release and has not been shown yet. `--no-hooks` leaves nothing to decide.
 */
export function pendingReview(summary: AgentIntegrationsSummary | null | undefined): boolean {
    if (!summary || summary.fixed) {
        return false;
    }
    return summary.providers.some((entry) => entry.state === 'unset' || (entry.state === 'on' && !entry.reviewed));
}

/** Migrated providers left without a choice, minus those the person already answered or is answering. */
export function providersToKeep(
    summary: AgentIntegrationsSummary | null | undefined,
    answered: readonly string[],
    busy: string | null
): AgentIntegration['provider'][] {
    return (summary?.providers ?? [])
        .filter((entry) => entry.state === 'on' && !entry.reviewed && entry.provider !== busy && !answered.includes(entry.provider))
        .map((entry) => entry.provider);
}

function localSummary(): AgentIntegrationsSummary | null {
    return serverInfoOf(LOCAL_ENDPOINT_ID).agentIntegrations;
}

export function useAgentIntegrations(): AgentIntegrationsSummary | null {
    return useServers((s) => (hasLocalMachine() ? (s.byEndpoint[LOCAL_ENDPOINT_ID]?.agentIntegrations ?? null) : null));
}

/* The files the integration writes, with their paths; only the app on this machine is told. */
export async function loadIntegrationFiles(): Promise<AgentIntegrationFile[]> {
    const link = transportFor(LOCAL_ENDPOINT_ID);
    if (!link) {
        return [];
    }
    return (await link.request('endpoint.agentIntegrations', {})).files;
}

/* Allows or refuses one provider on this computer's machine and answers what happened in each file. */
export async function setAgentIntegration(provider: AgentKind, on: boolean): Promise<AgentIntegrationReport[]> {
    const link = transportFor(LOCAL_ENDPOINT_ID);
    if (!link) {
        throw new Error('The machine is not answering');
    }
    const { summary, report } = await link.request('endpoint.setAgentIntegration', { provider, on });
    useServers.getState().setAgentIntegrations(LOCAL_ENDPOINT_ID, summary);
    return report;
}

/*
 * Opens the consent dialog once this computer's machine has something to ask and the welcome is out of
 * the way, and closes it in a window whose question was answered elsewhere. "Not now" only closes it
 * for this run, so a home that stays undecided asks again at the next start.
 */
export function startAgentIntegrationsPrompt(): () => void {
    let dismissed = false;
    const check = (): void => {
        if (!hasLocalMachine()) {
            return;
        }
        const pending = pendingReview(localSummary());
        const { onboarding, agentIntegrations, setAgentIntegrations } = useUi.getState();
        if (pending && !dismissed && !agentIntegrations && onboarding === null) {
            setAgentIntegrations(true);
        }
    };
    const offServers = useServers.subscribe(check);
    const offUi = useUi.subscribe((state, before) => {
        if (before.agentIntegrations && !state.agentIntegrations) {
            dismissed = true;
        }
        check();
    });
    check();
    return () => {
        offServers();
        offUi();
    };
}

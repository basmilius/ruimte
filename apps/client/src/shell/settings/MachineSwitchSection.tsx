import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsRow } from '@ruimte/ui/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@ruimte/ui/controls';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { transportFor } from '@/transport';
import { useEndpointConnection } from '@/transport/status';

/*
 * A switch about agents that lives in the machine's own `endpoint.json`, since the daemon is what acts
 * on it and a client-side switch would hold nothing back: what an agent may take away, and whether a
 * chat on a limit is taken up again on a clock.
 */
export type MachineSwitch = 'agentsDeleteAnyView' | 'resumeAtReset';

// The i18n group under `agents` each switch reads its words from.
const WORDS: Record<MachineSwitch, string> = { agentsDeleteAnyView: 'deleteAnyView', resumeAtReset: 'resumeAtReset' };

/* The wire takes name, icon and the switch together, so the row sends back the name and icon the machine already carries. */
function MachineSwitchRow({ endpoint, setting, searchId }: { endpoint: Endpoint; setting: MachineSwitch; searchId?: string }) {
    const { t } = useTranslation('settings');
    const info = useServers((s) => s.byEndpoint[endpoint.id]);
    const connection = useEndpointConnection(endpoint.id);
    const connected = connection.status === 'open';
    const [busy, setBusy] = useState(false);
    const words = `agents.${WORDS[setting]}`;

    const set = async (checked: boolean): Promise<void> => {
        const link = transportFor(endpoint.id);
        if (!link) {
            return;
        }
        setBusy(true);
        try {
            const next = await link.request('endpoint.setIdentity', {
                // A machine nobody named answers to its own default, and sending that name back would make it chosen.
                name: info?.nameSource === 'chosen' ? (info.label ?? null) : null,
                icon: info?.icon ?? null,
                [setting]: checked
            });
            useServers.getState().setIdentity(endpoint.id, {
                label: next.label,
                nameSource: next.nameSource ?? null,
                icon: next.icon ?? null,
                agentsDeleteAnyView: next.agentsDeleteAnyView === true,
                refuseStatements: next.refuseStatements === true,
                resumeAtReset: next.resumeAtReset === true
            });
        } catch (e) {
            useToasts.getState().show({
                id: `endpoint-${setting}-${endpoint.id}`,
                kind: 'error',
                title: t('machine.toast.saveFailed', { machine: endpoint.label }),
                description: e instanceof Error ? e.message : t('machine.toast.unchanged')
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <SettingsRow
            searchId={searchId}
            label={t(`${words}.label`)}
            description={connected ? t(`${words}.description`) : connection.noLink === true ? t(`${words}.notConnected`) : t('machine.notAnswering')}
            control={
                <Toggle
                    checked={info?.[setting] === true}
                    onChange={(checked) => void set(checked)}
                    // The section names the machine, a screen reader reading the switch alone does not.
                    label={t(`${words}.rowLabel`, { machine: endpoint.label })}
                    disabled={busy || !connected}
                />
            }
        />
    );
}

/*
 * One section per machine for what its agents may do, under the settings about agents rather than in
 * the Account pane. That pane is about pairing a machine and whether it answers; this is about an agent.
 */
export function MachineSwitchSections() {
    const { t } = useTranslation('settings');
    const stored = useEndpoints((s) => s.endpoints);
    const endpoints = useMemo(() => listedEndpoints(stored), [stored]);
    // Nothing here holds a link. Opening settings must not connect to every machine, so a switch reads what a connected machine last said.

    // This machine first, which is the one a person with a single machine is looking at.
    const ordered = [
        ...endpoints.filter((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID),
        ...endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)
    ];

    return (
        <>
            {ordered.map((endpoint, index) => (
                <SettingsSection
                    key={endpoint.id}
                    title={t('agents.machine.title', { machine: endpoint.label })}
                    description={t('agents.machine.description')}
                    scope="machine"
                >
                    <MachineSwitchRow endpoint={endpoint} setting="resumeAtReset" searchId={index === 0 ? 'agents.resumeAtReset' : undefined} />
                    <MachineSwitchRow endpoint={endpoint} setting="agentsDeleteAnyView" searchId={index === 0 ? 'agents.deleteAnyView' : undefined} />
                </SettingsSection>
            ))}
        </>
    );
}

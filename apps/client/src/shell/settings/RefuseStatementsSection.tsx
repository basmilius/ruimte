import { useEffect, useState } from 'react';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { pool, transportFor } from '@/transport';
import { useEndpointConnection } from '@/transport/status';

/*
 * Whether one machine takes a statement from the address book at all. It is the machine's own switch,
 * in `endpoint.json` beside what an agent may delete, because the daemon is what lets a key in; the
 * wire takes name, icon and switches together, so the row sends back the name and icon the machine has.
 */
function RefuseStatementsRow({ endpoint }: { endpoint: Endpoint }) {
    const info = useServers((s) => s.byEndpoint[endpoint.id]);
    const connected = useEndpointConnection(endpoint.id).status === 'open';
    const [busy, setBusy] = useState(false);

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
                refuseStatements: checked
            });
            useServers.getState().setIdentity(endpoint.id, {
                label: next.label,
                nameSource: next.nameSource ?? null,
                icon: next.icon ?? null,
                agentsDeleteAnyView: next.agentsDeleteAnyView === true,
                refuseStatements: next.refuseStatements === true
            });
        } catch (e) {
            useToasts.getState().show({
                id: `endpoint-refuse-statements-${endpoint.id}`,
                kind: 'error',
                title: `${endpoint.label} could not save the change`,
                description: e instanceof Error ? e.message : 'The setting is unchanged.'
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <SettingsRow
            label={
                <span className="flex items-center gap-2">
                    <MachineGlyph icon={info?.icon ?? null} className="shrink-0 text-text-muted" />
                    <span className="truncate">{endpoint.label}</span>
                </span>
            }
            description={
                connected
                    ? 'On, only a pairing link lets a new client in. Off, a client signed in to an account this machine is on gets in, and shows up under Apps with access.'
                    : 'Not answering. Change this once the machine is back.'
            }
            control={
                <Toggle
                    checked={info?.refuseStatements === true}
                    onChange={(checked) => void set(checked)}
                    label={`Refuse sign-in through an account on ${endpoint.label}`}
                    disabled={busy || !connected}
                />
            }
        />
    );
}

/* One switch per machine, in the Machines pane next to the list of who has access. */
export function RefuseStatementsSection() {
    const endpoints = useEndpoints((s) => s.endpoints);
    // Every machine on the list keeps a socket while the pane is open, or its switch has nothing to read.
    useEffect(() => {
        const released = endpoints.map((endpoint: Endpoint) => pool.hold(endpoint));
        return () => {
            for (const release of released) {
                release();
            }
        };
    }, [endpoints]);

    const ordered = [
        ...endpoints.filter((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID),
        ...endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)
    ];

    return (
        <SettingsSection title="Refuse sign-in through an account" description="Saved per machine. Clients that already have access keep it.">
            {ordered.map((endpoint) => (
                <RefuseStatementsRow key={endpoint.id} endpoint={endpoint} />
            ))}
        </SettingsSection>
    );
}

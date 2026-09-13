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
 * What an agent on one machine may take away. It is the machine's own setting, in `endpoint.json`
 * beside the name and the icon, because the daemon is what enforces it and a client's own switch
 * would hold nothing back. The wire takes name, icon and this together, so the row sends the name
 * and the icon the machine already carries back unchanged.
 */
function DeleteAnyViewRow({ endpoint }: { endpoint: Endpoint }) {
    const info = useServers((s) => s.byEndpoint[endpoint.id]);
    const connected = useEndpointConnection(endpoint.id).status === 'open';
    const [busy, setBusy] = useState(false);
    // The row is one of several machines, so the switch says which one it speaks for.
    const label = `Agents on ${endpoint.label} may delete any view or node`;

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
                agentsDeleteAnyView: checked
            });
            useServers.getState().setIdentity(endpoint.id, {
                label: next.label,
                nameSource: next.nameSource ?? null,
                icon: next.icon ?? null,
                agentsDeleteAnyView: next.agentsDeleteAnyView === true
            });
        } catch (e) {
            useToasts.getState().show({
                id: `endpoint-delete-any-view-${endpoint.id}`,
                kind: 'error',
                title: `${endpoint.label} did not take the change`,
                description: e instanceof Error ? e.message : 'What an agent may delete is still what it was.'
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
                    ? 'Off, an agent only removes the views and nodes it made itself. On, it may remove any view and any node of any project there, yours as well.'
                    : 'Not answering, so what an agent may delete there cannot be read or changed.'
            }
            control={
                <Toggle checked={info?.agentsDeleteAnyView === true} onChange={(checked) => void set(checked)} label={label} disabled={busy || !connected} />
            }
        />
    );
}

/*
 * One switch per machine, under the settings about what an agent may do rather than in the Machines
 * pane: the pane is about pairing a machine and whether it answers, and this is about an agent.
 */
export function DeleteAnyViewSection() {
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

    // This machine first, which is the one a person with a single machine is looking at.
    const ordered = [
        ...endpoints.filter((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID),
        ...endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)
    ];

    return (
        <SettingsSection
            title="What an agent may delete"
            description="Every machine keeps this itself, so it holds for every client that opens a project there."
        >
            {ordered.map((endpoint) => (
                <DeleteAnyViewRow key={endpoint.id} endpoint={endpoint} />
            ))}
        </SettingsSection>
    );
}

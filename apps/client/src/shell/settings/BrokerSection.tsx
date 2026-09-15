import { useEffect, useState } from 'react';
import { brokerHostOf, brokerUrlProblem, type BrokerSetting } from '@ruimte/pulsar';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { pool, transportFor } from '@/transport';
import { useEndpointConnection } from '@/transport/status';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';

type BrokerMode = BrokerSetting['mode'];

const MODES: { value: BrokerMode; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'custom', label: 'Custom' },
    { value: 'off', label: 'Off' }
];

/*
 * Which broker one machine announces itself to. It lives in `endpoint.json` because the daemon is the
 * one that dials it; the wire takes name, icon and switches together, so the row sends back the name
 * and icon the machine has, the way the refusal switch does.
 */
function BrokerRow({ endpoint }: { endpoint: Endpoint }) {
    const info = useServers((s) => s.byEndpoint[endpoint.id]);
    const brokerUrl = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpoint.id)?.brokerUrl ?? null);
    const connected = useEndpointConnection(endpoint.id).status === 'open';
    const setting = info?.broker ?? null;
    const [mode, setMode] = useState<BrokerMode>(setting?.mode ?? 'default');
    const [draft, setDraft] = useState(setting?.mode === 'custom' ? setting.url : '');
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [shown, setShown] = useState(setting);

    // Another client may change it while this pane is open; the row follows the machine during render rather than a render later.
    if (shown !== setting) {
        setShown(setting);
        setMode(setting?.mode ?? 'default');
        setDraft(setting?.mode === 'custom' ? setting.url : '');
        setProblem(null);
    }

    const save = async (next: BrokerSetting): Promise<void> => {
        const link = transportFor(endpoint.id);
        if (!link) {
            return;
        }
        setBusy(true);
        try {
            const answer = await link.request('endpoint.setIdentity', {
                // A machine nobody named answers to its own default, and sending that name back would make it chosen.
                name: info?.nameSource === 'chosen' ? (info.label ?? null) : null,
                icon: info?.icon ?? null,
                broker: next
            });
            useServers.getState().setIdentity(endpoint.id, {
                label: answer.label,
                nameSource: answer.nameSource ?? null,
                icon: answer.icon ?? null,
                agentsDeleteAnyView: answer.agentsDeleteAnyView === true,
                broker: answer.broker ?? null,
                brokerFixed: answer.brokerFixed === true
            });
            useEndpoints.getState().learnBrokerUrl(endpoint.id, answer.brokerUrl ?? null);
        } catch (e) {
            useToasts.getState().show({
                id: `endpoint-broker-${endpoint.id}`,
                kind: 'error',
                title: `${endpoint.label} could not save the change`,
                description: e instanceof Error ? e.message : 'The setting is unchanged.'
            });
        } finally {
            setBusy(false);
        }
    };

    const pick = (next: BrokerMode): void => {
        setMode(next);
        setProblem(null);
        // A custom broker needs its URL first; the field below saves it.
        if (next !== 'custom') {
            void save({ mode: next });
        }
    };

    const saveCustom = (): void => {
        const url = draft.trim();
        const found = brokerUrlProblem(url);
        setProblem(found);
        if (found === null) {
            void save({ mode: 'custom', url });
        }
    };

    const description = (): string => {
        if (!connected) {
            return 'Not answering. Change this once the machine is back.';
        }
        if (setting === null) {
            return 'This machine runs a version without this setting.';
        }
        const where = brokerUrl === null ? 'No broker.' : `On ${brokerHostOf(brokerUrl)}.`;
        return info?.brokerFixed ? `${where} Set when the machine started, so this choice waits until it runs without that.` : where;
    };

    return (
        <SettingsRow
            label={
                <span className="flex items-center gap-2">
                    <MachineGlyph icon={info?.icon ?? null} className="shrink-0 text-text-muted" />
                    <span className="truncate">{endpoint.label}</span>
                </span>
            }
            description={description()}
            control={
                <Select
                    value={mode}
                    items={MODES}
                    onValueChange={pick}
                    label={`Broker for ${endpoint.label}`}
                    disabled={busy || !connected || setting === null}
                />
            }
        >
            {mode === 'custom' && connected && setting !== null && (
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <input
                            className="field grow"
                            aria-label={`Broker URL for ${endpoint.label}`}
                            placeholder="wss://broker.example.com"
                            value={draft}
                            spellCheck={false}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    saveCustom();
                                }
                            }}
                        />
                        <Button
                            variant="secondary"
                            disabled={busy || draft.trim() === '' || (setting.mode === 'custom' && draft.trim() === setting.url)}
                            onClick={saveCustom}
                        >
                            Save
                        </Button>
                    </div>
                    {problem && <div className="text-xs text-status-error">{problem}</div>}
                </div>
            )}
        </SettingsRow>
    );
}

/* One choice per machine, in the Machines pane under the refusal switch. */
export function BrokerSection() {
    const endpoints = useEndpoints((s) => s.endpoints);
    // Every machine on the list keeps a socket while the pane is open, or its row has nothing to read.
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
        <SettingsSection title="Broker" description="Saved per machine. How a signed-in client finds the machine without its address.">
            {ordered.map((endpoint) => (
                <BrokerRow key={endpoint.id} endpoint={endpoint} />
            ))}
        </SettingsSection>
    );
}

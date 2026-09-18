import { useEffect, useState, type ReactElement } from 'react';
import { Check, Copy, Link2, Trash } from 'lucide-react';
import { brokerHostOf, brokerUrlProblem, type BrokerSetting } from '@ruimte/pulsar';
import type { AuthSession } from '@ruimte/contracts';
import { forgetEndpoint } from '@/endpoint';
import { ConfirmDialog } from '@/shell/settings/ConfirmDialog';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Skeleton, Toggle } from '@/shell/settings/controls';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { pool, transportFor } from '@/transport';
import { useEndpointConnection } from '@/transport/status';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';

const failureText = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

/* A disabled control does not take the pointer, so the reason sits on a wrapper around it. */
export function WithReason({ reason, children }: { reason: string | null; children: ReactElement }) {
    if (reason === null) {
        return children;
    }
    return (
        <Tooltip label={reason}>
            <span className="inline-flex">{children}</span>
        </Tooltip>
    );
}

/*
 * The switches that live in `endpoint.json`. The wire takes name, icon and switches together, so a
 * switch sends back the name and icon the machine has; a machine nobody named answers to its own
 * default, and sending that name back would make it chosen.
 */
const saveMachineSetting = async (
    endpoint: Endpoint,
    patch: { broker?: BrokerSetting; refuseStatements?: boolean; streamingAllowed?: boolean }
): Promise<void> => {
    const link = transportFor(endpoint.id);
    if (!link) {
        return;
    }
    const info = useServers.getState().byEndpoint[endpoint.id];
    try {
        const answer = await link.request('endpoint.setIdentity', {
            name: info?.nameSource === 'chosen' ? (info.label ?? null) : null,
            icon: info?.icon ?? null,
            ...patch
        });
        useServers.getState().setIdentity(endpoint.id, {
            label: answer.label,
            nameSource: answer.nameSource ?? null,
            icon: answer.icon ?? null,
            agentsDeleteAnyView: answer.agentsDeleteAnyView === true,
            refuseStatements: answer.refuseStatements === true,
            streamingAllowed: answer.streamingAllowed ?? null,
            broker: answer.broker ?? null,
            brokerFixed: answer.brokerFixed === true
        });
        useEndpoints.getState().learnBrokerUrl(endpoint.id, answer.brokerUrl ?? null);
    } catch (e) {
        useToasts.getState().show({
            id: `endpoint-setting-${endpoint.id}`,
            kind: 'error',
            title: `${endpoint.label} could not save the change`,
            description: failureText(e, 'The setting is unchanged.')
        });
    }
};

/*
 * The experiment, per machine: its wire over a WebRTC DataChannel instead of the socket. Switching
 * reconnects straight away, and a direct connection that does not come up stays one that failed,
 * with the reason on the row, rather than quietly turning back into a socket.
 */
export function DirectRow({ endpoint, available }: { endpoint: Endpoint; available: boolean }) {
    const connection = useEndpointConnection(endpoint.id);
    const failure = endpoint.direct === true && connection.status !== 'open' ? (connection.failure ?? null) : null;

    if (!available) {
        return <SettingsRow muted label="Direct" description="Reached through the broker only, so this machine is always direct." />;
    }

    const toggle = (direct: boolean): void => {
        useEndpoints.getState().setDirect(endpoint.id, direct);
        pool.reconnect(endpoint.id);
    };

    return (
        <SettingsRow
            label="Direct"
            description={
                failure !== null ? (
                    <span className="text-status-error">{failure}</span>
                ) : endpoint.brokerUrl ? (
                    `Connect over WebRTC, found through the broker on ${brokerHostOf(endpoint.brokerUrl)} (experimental).`
                ) : (
                    'Connect over WebRTC instead of the socket (experimental).'
                )
            }
            control={<Toggle checked={endpoint.direct === true} onChange={toggle} label={`Connect directly to ${endpoint.label} (experimental)`} />}
        />
    );
}

type BrokerMode = BrokerSetting['mode'];

const MODES: { value: BrokerMode; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'custom', label: 'Custom' },
    { value: 'off', label: 'Off' }
];

/* Which broker the machine announces itself to. It lives on the machine because the daemon is the one that dials it. */
export function BrokerRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const info = useServers((s) => s.byEndpoint[endpoint.id]);
    const setting = info?.broker ?? null;
    const [mode, setMode] = useState<BrokerMode>(setting?.mode ?? 'default');
    const [draft, setDraft] = useState(setting?.mode === 'custom' ? setting.url : '');
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [shown, setShown] = useState(setting);

    // Another client may change it while the dialog is open; the row follows the machine during render rather than a render later.
    if (shown !== setting) {
        setShown(setting);
        setMode(setting?.mode ?? 'default');
        setDraft(setting?.mode === 'custom' ? setting.url : '');
        setProblem(null);
    }

    const save = async (next: BrokerSetting): Promise<void> => {
        setBusy(true);
        await saveMachineSetting(endpoint, { broker: next });
        setBusy(false);
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
        if (reason !== null) {
            return 'Not answering. Change this once the machine is back.';
        }
        if (setting === null) {
            return 'This machine runs a version without this setting.';
        }
        const where = endpoint.brokerUrl ? `On ${brokerHostOf(endpoint.brokerUrl)}.` : 'No broker.';
        const fixed = info?.brokerFixed ? ' Set when the machine started, so this choice waits until it runs without that.' : '';
        return `How a signed-in client finds the machine without its address. ${where}${fixed}`;
    };

    return (
        <SettingsRow
            label="Broker"
            description={description()}
            control={
                <WithReason reason={reason}>
                    <Select
                        value={mode}
                        items={MODES}
                        onValueChange={pick}
                        label={`Broker for ${endpoint.label}`}
                        disabled={busy || reason !== null || setting === null}
                    />
                </WithReason>
            }
        >
            {mode === 'custom' && reason === null && setting !== null && (
                <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <input
                            className="field min-w-0 flex-1 basis-48"
                            aria-label={`Broker URL for ${endpoint.label}`}
                            placeholder="wss://broker.example.com"
                            value={draft}
                            spellCheck={false}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation();
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
                    {problem && <div className="text-xs break-words text-status-error">{problem}</div>}
                </div>
            )}
        </SettingsRow>
    );
}

/* Whether the machine takes a statement from the address book at all; the daemon is what lets a key in. */
export function RefuseStatementsRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const refuses = useServers((s) => s.byEndpoint[endpoint.id]?.refuseStatements === true);
    const [busy, setBusy] = useState(false);

    const set = async (checked: boolean): Promise<void> => {
        setBusy(true);
        await saveMachineSetting(endpoint, { refuseStatements: checked });
        setBusy(false);
    };

    return (
        <SettingsRow
            label="Refuse sign-in through an account"
            description={
                reason === null
                    ? 'On, only a pairing link lets a new client in. Off, a client signed in to an account this machine is on gets in, and shows up under Apps with access. Clients that already have access keep it.'
                    : 'Not answering. Change this once the machine is back.'
            }
            control={
                <WithReason reason={reason}>
                    <Toggle
                        checked={refuses}
                        onChange={(checked) => void set(checked)}
                        label={`Refuse sign-in through an account on ${endpoint.label}`}
                        disabled={busy || reason !== null}
                    />
                </WithReason>
            }
        />
    );
}

/* One daemon policy covers today's browser stream and the device streams that will follow it. */
export function StreamingRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const allowed = useServers((s) => s.byEndpoint[endpoint.id]?.streamingAllowed ?? null);
    const [busy, setBusy] = useState(false);
    const unavailable = reason ?? (allowed === null ? 'This machine runs a version without this setting' : null);

    const set = async (checked: boolean): Promise<void> => {
        setBusy(true);
        await saveMachineSetting(endpoint, { streamingAllowed: checked });
        setBusy(false);
    };

    return (
        <SettingsRow
            label="Browser and device streaming"
            description={
                reason !== null
                    ? 'Not answering. Change this once the machine is back.'
                    : allowed === null
                      ? 'This machine runs a version without this setting.'
                      : 'Allow this machine to stream browser pages and device screens to clients without a native view of their own.'
            }
            control={
                <WithReason reason={unavailable}>
                    <Toggle
                        checked={allowed !== false}
                        onChange={(checked) => void set(checked)}
                        label={`Allow browser and device streaming from ${endpoint.label}`}
                        disabled={busy || unavailable !== null}
                    />
                </WithReason>
            }
        />
    );
}

const ago = (timestamp: number): string => {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) {
        return 'just now';
    }
    if (seconds < 3600) {
        return `${Math.floor(seconds / 60)}m ago`;
    }
    if (seconds < 86_400) {
        return `${Math.floor(seconds / 3600)}h ago`;
    }
    return `${Math.floor(seconds / 86_400)}d ago`;
};

/* A pairing link that names the loopback address can only be a machine that nobody else can reach. */
const onlyLoopback = (link: string): boolean => {
    try {
        const host = new URL(link).hostname;
        return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
    } catch {
        return false;
    }
};

/* The browsers and apps that paired with one machine, each with a way to cut it off, and on this machine a way to invite one. */
export function MachineAccess({ endpoint }: { endpoint: Endpoint }) {
    const reachability = useServers((s) => s.byEndpoint[endpoint.id]?.reachability ?? endpoint.reachability);
    const status = useEndpointConnection(endpoint.id).status;
    const [sessions, setSessions] = useState<AuthSession[] | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [target, setTarget] = useState<AuthSession | null>(null);
    const [busy, setBusy] = useState(false);
    const [link, setLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const load = (): void => {
        const transport = transportFor(endpoint.id);
        if (!transport) {
            return;
        }
        transport
            .request('auth.sessions', {})
            .then((answer) => {
                setSessions(answer.sessions);
                setFailure(null);
            })
            .catch((e: unknown) => setFailure(failureText(e, 'Could not list paired clients')));
    };

    // The list belongs to the machine behind the socket, so it loads again on every reconnect.
    useEffect(() => {
        if (status === 'open') {
            load();
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [status, endpoint.id]);

    const revoke = async (): Promise<void> => {
        const session = target;
        const transport = transportFor(endpoint.id);
        if (!session || !transport) {
            return;
        }
        await transport.request('auth.revoke', { id: session.id });
        if (session.current) {
            // Revoking this client's own access leaves a row that can no longer get in.
            await forgetEndpoint(endpoint.id);
            return;
        }
        load();
    };

    const showLink = async (): Promise<void> => {
        const transport = transportFor(endpoint.id);
        if (!transport) {
            return;
        }
        setBusy(true);
        try {
            setLink((await transport.request('auth.pairingToken', {})).url);
            setCopied(false);
        } catch (e) {
            setFailure(failureText(e, 'Could not create a pairing link'));
        } finally {
            setBusy(false);
        }
    };

    /*
     * On this machine your own client needs no pairing to get in, so a row for it adds nothing to a
     * list of what else has access. On a machine you paired with it stays: revoking it there is the
     * one way to hand your own access back to that daemon.
     */
    const listed = reachability === 'loopback' ? (sessions?.filter((session) => !session.current) ?? null) : sessions;

    const copyLink = (): void => {
        if (!link) {
            return;
        }
        void navigator.clipboard?.writeText(link).catch(() => undefined);
        setCopied(true);
    };

    return (
        <SettingsSection
            title="Apps with access"
            description="Browsers and apps paired with this machine."
            action={
                reachability === 'loopback' && (
                    <Button variant="secondary" disabled={busy || status !== 'open'} onClick={() => void showLink()}>
                        <Icon icon={Link2} size={12} /> Show pairing link
                    </Button>
                )
            }
        >
            {link && (
                <SettingsRow
                    label="Pairing link"
                    description={
                        onlyLoopback(link)
                            ? 'This machine only accepts local connections. Start it with --host 0.0.0.0 so other machines can use the link.'
                            : 'Paste it under Add a machine on the other device. It works once and expires after ten minutes.'
                    }
                >
                    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-sunken p-2.5">
                        <code className="min-w-0 grow truncate font-mono text-code text-text select-text">{link}</code>
                        <Tooltip label={copied ? 'Copied' : 'Copy pairing link'} name>
                            <button className="icon-btn h-7 w-7 shrink-0" onClick={copyLink}>
                                {copied ? <Icon icon={Check} size={16} /> : <Icon icon={Copy} size={16} />}
                            </button>
                        </Tooltip>
                    </div>
                </SettingsRow>
            )}
            {status !== 'open' && sessions === null && failure === null && (
                <SettingsRow muted label="Not answering" description="The list loads once the machine is back." />
            )}
            {status === 'open' && listed === null && failure === null && (
                <SettingsRow label={<Skeleton className="w-40" />} control={<Skeleton className="w-8" />} />
            )}
            {listed?.length === 0 && <SettingsRow muted label="Nothing else has access to this machine." />}
            {listed?.map((session) => (
                <SettingsRow
                    key={session.id}
                    label={
                        <span className="break-words">
                            {session.label}
                            {session.current && <span className="ml-1.5 text-xs text-accent">this client</span>}
                        </span>
                    }
                    description={`${session.origin === 'statement' ? 'Signed in through an account' : 'Paired with a link'} ${new Date(session.createdAt).toLocaleDateString()}, last seen ${ago(session.lastSeenAt)}`}
                    control={
                        <Tooltip label="Revoke access">
                            <button className="icon-btn h-8 w-8 shrink-0" aria-label={`Revoke ${session.label}`} onClick={() => setTarget(session)}>
                                <Icon icon={Trash} size={16} />
                            </button>
                        </Tooltip>
                    }
                />
            ))}
            {failure && <SettingsRow muted label={<span className="break-words text-status-error">{failure}</span>} />}
            <ConfirmDialog
                open={target !== null}
                onOpenChange={(open) => (open ? undefined : setTarget(null))}
                title={`Revoke ${target?.label ?? 'this client'}?`}
                description={
                    target?.current
                        ? 'This is the client you are using. It loses access to this machine and forgets it here. Pair again to regain access.'
                        : target?.origin === 'statement'
                          ? 'It loses access the next time it connects, and signing in through an account will not let it back in. Pairing again needs a link.'
                          : 'It loses access the next time it connects. Pairing again needs a new link.'
                }
                confirmLabel="Revoke"
                onConfirm={revoke}
            />
        </SettingsSection>
    );
}

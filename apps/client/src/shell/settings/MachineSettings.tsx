import { useEffect, useState, type ReactElement } from 'react';
import i18next from 'i18next';
import { Trash } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { brokerHostOf, brokerUrlProblem, type BrokerSetting } from '@ruimte/pulsar';
import type { AuthSession, LanDoor } from '@ruimte/contracts';
import { messageOf, Segmented, Skeleton, Switch, Button, IconButton, Tooltip, FormError, Input } from '@basmilius/desktop-ui';
import { formatNumericDate, formatAgo } from '@basmilius/desktop-ui/format';
import { ConfirmDialog, SettingsRow } from '@basmilius/desktop-ui/settings';
import { forgetEndpoint } from '@/endpoint';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { pool, transportFor } from '@/transport';
import { useEndpointConnection } from '@/transport/status';

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
async function saveMachineSetting(
    endpoint: Endpoint,
    patch: { broker?: BrokerSetting; lanDoor?: boolean; streamingAllowed?: boolean; resumeAtReset?: boolean }
): Promise<void> {
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
            streamingAllowed: answer.streamingAllowed ?? null,
            resumeAtReset: answer.resumeAtReset === true,
            broker: answer.broker ?? null,
            brokerFixed: answer.brokerFixed === true,
            lanDoor: answer.lanDoor ?? null,
            lanDoorFixed: answer.lanDoorFixed === true
        });
        useEndpoints.getState().learnBrokerUrl(endpoint.id, answer.brokerUrl ?? null);
        useEndpoints.getState().learnLan(endpoint.id, answer.lan ?? null);
    } catch (e) {
        useToasts.getState().show({
            id: `endpoint-setting-${endpoint.id}`,
            kind: 'error',
            title: i18next.t('settings:machine.toast.saveFailed', { machine: endpoint.label }),
            description: messageOf(e, i18next.t('settings:machine.toast.unchanged'))
        });
    }
}

/*
 * Running the wire to this machine over a WebRTC DataChannel instead of its socket, an experiment;
 * every other machine is reached that way already. Switching reconnects immediately, and a direct
 * connection that fails stays failed, with the reason shown on the row, rather than silently falling
 * back to the socket.
 */
export function DirectRow({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const connection = useEndpointConnection(endpoint.id);
    const failure = endpoint.direct === true && connection.status !== 'open' ? (connection.failure ?? null) : null;

    const toggle = (direct: boolean): void => {
        useEndpoints.getState().setDirect(endpoint.id, direct);
        pool.reconnect(endpoint.id);
    };

    return (
        <SettingsRow
            searchId="machines.machine.direct"
            label={t('machine.direct.label')}
            description={
                failure !== null ? (
                    <span className="text-status-error" role="alert">
                        {failure}
                    </span>
                ) : (
                    t('machine.direct.description')
                )
            }
            control={<Switch checked={endpoint.direct === true} onCheckedChange={toggle} label={t('machine.direct.toggle', { machine: endpoint.label })} />}
        />
    );
}

type BrokerMode = BrokerSetting['mode'];

const MODES: readonly BrokerMode[] = ['default', 'custom', 'off'];

/* Which broker the machine announces itself to. It lives on the machine because the daemon is the one that dials it. */
export function BrokerRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const info = useServers((s) => s.byEndpoint[endpoint.id]);
    const setting = info?.broker ?? null;
    const [mode, setMode] = useState<BrokerMode>(setting?.mode ?? 'default');
    const [draft, setDraft] = useState(setting?.mode === 'custom' ? setting.url : '');
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [shown, setShown] = useState(setting);

    // Another client may change it while the detail is open; the row follows the machine during render rather than a render later.
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
            return t('machine.notAnswering');
        }
        if (setting === null) {
            return t('machine.unsupported');
        }
        const where = endpoint.brokerUrl ? t('machine.broker.on', { host: brokerHostOf(endpoint.brokerUrl) }) : t('machine.broker.none');
        const fixed = info?.brokerFixed ? t('machine.broker.fixed') : '';
        return t('machine.broker.description', { where, fixed });
    };

    return (
        <SettingsRow
            searchId="machines.machine.broker"
            label={t('machine.broker.label')}
            description={description()}
            control={
                <WithReason reason={reason}>
                    <Segmented
                        value={mode}
                        options={MODES.map((id) => ({ id, label: t(`machine.broker.modes.${id}`) }))}
                        onValueChange={pick}
                        label={t('machine.broker.selectLabel', { machine: endpoint.label })}
                        disabled={busy || reason !== null || setting === null}
                    />
                </WithReason>
            }
        >
            {mode === 'custom' && reason === null && setting !== null && (
                <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Input
                            className="min-w-0 flex-1 basis-48"
                            aria-label={t('machine.broker.urlLabel', { machine: endpoint.label })}
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
                            {t('common:action.save')}
                        </Button>
                    </div>
                    {problem && <FormError className="break-words">{problem}</FormError>}
                </div>
            )}
        </SettingsRow>
    );
}

/* Where the door listens, as addresses a person could type: a port is no quantity, so it is not formatted as a number. */
function doorAddresses(lan: LanDoor): string {
    return lan.addresses.map((address) => (address.includes(':') ? `[${address}]:${lan.port}` : `${address}:${lan.port}`)).join(', ');
}

/*
 * Whether the machine keeps its door on the local network open, so a client on the same network
 * reaches it without the broker. It lives on the machine because the daemon is the one that listens.
 */
export function LanDoorRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const kept = useServers((s) => s.byEndpoint[endpoint.id]?.lanDoor ?? null);
    const fixed = useServers((s) => s.byEndpoint[endpoint.id]?.lanDoorFixed === true);
    const [busy, setBusy] = useState(false);
    const unavailable = reason ?? (kept === null ? t('machine.unsupportedReason') : fixed ? t('machine.lanDoor.fixed') : null);

    const set = async (checked: boolean): Promise<void> => {
        setBusy(true);
        await saveMachineSetting(endpoint, { lanDoor: checked });
        setBusy(false);
    };

    const description = (): string => {
        if (reason !== null) {
            return t('machine.notAnswering');
        }
        if (kept === null) {
            return t('machine.unsupported');
        }
        const lan = endpoint.lan ?? null;
        const where =
            lan === null
                ? t(kept ? 'machine.lanDoor.notListening' : 'machine.lanDoor.closed')
                : lan.addresses.length > 0
                  ? t('machine.lanDoor.open', { addresses: doorAddresses(lan) })
                  : t('machine.lanDoor.noAddress', { port: String(lan.port) });
        return fixed ? `${where} ${t('machine.lanDoor.fixedNote')}` : where;
    };

    return (
        <SettingsRow
            searchId="machines.machine.lanDoor"
            label={t('machine.lanDoor.label')}
            description={description()}
            control={
                <WithReason reason={unavailable}>
                    <Switch
                        checked={kept === true}
                        onCheckedChange={(checked) => void set(checked)}
                        label={t('machine.lanDoor.toggle', { machine: endpoint.label })}
                        disabled={busy || unavailable !== null}
                    />
                </WithReason>
            }
        />
    );
}

/* One daemon policy covers today's browser stream and the device streams that will follow it. */
export function StreamingRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const allowed = useServers((s) => s.byEndpoint[endpoint.id]?.streamingAllowed ?? null);
    const [busy, setBusy] = useState(false);
    const unavailable = reason ?? (allowed === null ? t('machine.unsupportedReason') : null);

    const set = async (checked: boolean): Promise<void> => {
        setBusy(true);
        await saveMachineSetting(endpoint, { streamingAllowed: checked });
        setBusy(false);
    };

    return (
        <SettingsRow
            searchId="machines.machine.streaming"
            label={t('machine.streaming.label')}
            description={reason !== null ? t('machine.notAnswering') : allowed === null ? t('machine.unsupported') : t('machine.streaming.description')}
            control={
                <WithReason reason={unavailable}>
                    <Switch
                        checked={allowed !== false}
                        onCheckedChange={(checked) => void set(checked)}
                        label={t('machine.streaming.toggle', { machine: endpoint.label })}
                        disabled={busy || unavailable !== null}
                    />
                </WithReason>
            }
        />
    );
}

function ago(timestamp: number): string {
    return formatAgo(Date.now() - timestamp);
}

/* The browsers and apps one machine let in, each with a way to cut it off. */
export function MachineAccess({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const reachability = useServers((s) => s.byEndpoint[endpoint.id]?.reachability ?? endpoint.reachability);
    const status = useEndpointConnection(endpoint.id).status;
    const [sessions, setSessions] = useState<AuthSession[] | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [target, setTarget] = useState<AuthSession | null>(null);

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
            .catch((e: unknown) => setFailure(messageOf(e, t('machine.access.listFailed'))));
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

    /*
     * On this machine your own client gets in with the local secret, so a row for it adds nothing to a
     * list of what else has access. On another machine it stays, since revoking it there is the one
     * way to hand your own access back to that daemon.
     */
    const listed = reachability === 'loopback' ? (sessions?.filter((session) => !session.current) ?? null) : sessions;

    return (
        <SettingsSection title={t('machine.access.title')} description={t('machine.access.description')}>
            {status !== 'open' && sessions === null && failure === null && (
                <SettingsRow muted label={t('machine.access.silent.label')} description={t('machine.access.silent.description')} />
            )}
            {status === 'open' && listed === null && failure === null && (
                <SettingsRow label={<Skeleton className="w-40" />} control={<Skeleton className="w-8" />} />
            )}
            {listed?.length === 0 && <SettingsRow muted label={t('machine.access.empty')} />}
            {listed?.map((session) => (
                <SettingsRow
                    key={session.id}
                    label={
                        <span className="break-words">
                            {session.label}
                            {session.current && <span className="ml-1.5 text-xs text-accent">{t('machine.access.thisClient')}</span>}
                        </span>
                    }
                    description={t('machine.access.session', {
                        origin: session.origin === 'statement' ? t('machine.access.origin.statement') : t('machine.access.origin.link'),
                        date: formatNumericDate(session.createdAt),
                        ago: ago(session.lastSeenAt)
                    })}
                    control={
                        <IconButton
                            icon={Trash}
                            label={t('machine.access.revokeOne', { label: session.label })}
                            tooltip={t('machine.access.revoke')}
                            className="shrink-0"
                            onClick={() => setTarget(session)}
                        />
                    }
                />
            ))}
            {failure && (
                <SettingsRow
                    muted
                    label={
                        <span className="break-words text-status-error" role="alert">
                            {failure}
                        </span>
                    }
                />
            )}
            <ConfirmDialog
                open={target !== null}
                onOpenChange={(open) => (open ? undefined : setTarget(null))}
                title={t('machine.access.confirm.title', { label: target?.label ?? t('machine.access.thisClient') })}
                description={
                    target?.current
                        ? t('machine.access.confirm.current')
                        : target?.origin === 'statement'
                          ? t('machine.access.confirm.statement')
                          : t('machine.access.confirm.link')
                }
                confirmLabel={t('machine.access.confirm.action')}
                onConfirm={revoke}
            />
        </SettingsSection>
    );
}

import { useEffect, useState, type ReactElement } from 'react';
import i18next from 'i18next';
import { Check, Copy, Link2, Trash } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { brokerHostOf, brokerUrlProblem, type BrokerSetting } from '@ruimte/pulsar';
import type { AuthSession } from '@ruimte/contracts';
import { messageOf } from '@/pulsar/account';
import { forgetEndpoint } from '@/endpoint';
import { formatNumericDate } from '@/format/datetime';
import { formatAgo } from '@/format/duration';
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
import { FORM_ERROR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';

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
            title: i18next.t('settings:machine.toast.saveFailed', { machine: endpoint.label }),
            description: messageOf(e, i18next.t('settings:machine.toast.unchanged'))
        });
    }
};

/*
 * The per-machine experiment of running the wire over a WebRTC DataChannel instead of the socket.
 * Switching reconnects immediately, and a direct connection that fails stays failed, with the reason
 * shown on the row, rather than silently falling back to the socket.
 */
export function DirectRow({ endpoint, available }: { endpoint: Endpoint; available: boolean }) {
    const { t } = useTranslation('settings');
    const connection = useEndpointConnection(endpoint.id);
    const failure = endpoint.direct === true && connection.status !== 'open' ? (connection.failure ?? null) : null;

    if (!available) {
        return <SettingsRow muted label={t('machine.direct.label')} description={t('machine.direct.brokerOnly')} />;
    }

    const toggle = (direct: boolean): void => {
        useEndpoints.getState().setDirect(endpoint.id, direct);
        pool.reconnect(endpoint.id);
    };

    return (
        <SettingsRow
            label={t('machine.direct.label')}
            description={
                failure !== null ? (
                    <span className="text-status-error">{failure}</span>
                ) : endpoint.brokerUrl ? (
                    t('machine.direct.viaBroker', { host: brokerHostOf(endpoint.brokerUrl) })
                ) : (
                    t('machine.direct.description')
                )
            }
            control={<Toggle checked={endpoint.direct === true} onChange={toggle} label={t('machine.direct.toggle', { machine: endpoint.label })} />}
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
            label={t('machine.broker.label')}
            description={description()}
            control={
                <WithReason reason={reason}>
                    <Select
                        value={mode}
                        items={MODES.map((value) => ({ value, label: t(`machine.broker.modes.${value}`) }))}
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
                        <input
                            className="field min-w-0 flex-1 basis-48"
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
                    {problem && (
                        <p className={`${FORM_ERROR} break-words`} role="alert">
                            {problem}
                        </p>
                    )}
                </div>
            )}
        </SettingsRow>
    );
}

/* Whether the machine takes a statement from the address book at all; the daemon is what lets a key in. */
export function RefuseStatementsRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const refuses = useServers((s) => s.byEndpoint[endpoint.id]?.refuseStatements === true);
    const [busy, setBusy] = useState(false);

    const set = async (checked: boolean): Promise<void> => {
        setBusy(true);
        await saveMachineSetting(endpoint, { refuseStatements: checked });
        setBusy(false);
    };

    return (
        <SettingsRow
            label={t('machine.refuse.label')}
            description={reason === null ? t('machine.refuse.description') : t('machine.notAnswering')}
            control={
                <WithReason reason={reason}>
                    <Toggle
                        checked={refuses}
                        onChange={(checked) => void set(checked)}
                        label={t('machine.refuse.toggle', { machine: endpoint.label })}
                        disabled={busy || reason !== null}
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
            label={t('machine.streaming.label')}
            description={reason !== null ? t('machine.notAnswering') : allowed === null ? t('machine.unsupported') : t('machine.streaming.description')}
            control={
                <WithReason reason={unavailable}>
                    <Toggle
                        checked={allowed !== false}
                        onChange={(checked) => void set(checked)}
                        label={t('machine.streaming.toggle', { machine: endpoint.label })}
                        disabled={busy || unavailable !== null}
                    />
                </WithReason>
            }
        />
    );
}

const ago = (timestamp: number): string => formatAgo(Date.now() - timestamp);

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
    const { t } = useTranslation('settings');
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
            setFailure(messageOf(e, t('machine.access.linkFailed')));
        } finally {
            setBusy(false);
        }
    };

    /*
     * On this machine your own client needs no pairing to get in, so a row for it adds nothing to a
     * list of what else has access. On a machine you paired with, it stays, since revoking it there is
     * the one way to hand your own access back to that daemon.
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
            title={t('machine.access.title')}
            description={t('machine.access.description')}
            action={
                reachability === 'loopback' && (
                    <Button variant="secondary" disabled={busy || status !== 'open'} onClick={() => void showLink()}>
                        <Icon icon={Link2} size={12} /> {t('machine.access.showLink')}
                    </Button>
                )
            }
        >
            {link && (
                <SettingsRow
                    label={t('machine.access.link.label')}
                    description={onlyLoopback(link) ? t('machine.access.link.loopback') : t('machine.access.link.description')}
                >
                    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-sunken p-2.5">
                        <code className="min-w-0 grow truncate font-mono text-code text-text select-text">{link}</code>
                        <Tooltip label={copied ? t('machine.access.link.copied') : t('machine.access.link.copy')} name>
                            <button className="icon-btn icon-btn-sm" onClick={copyLink}>
                                {copied ? <Icon icon={Check} size={14} /> : <Icon icon={Copy} size={14} />}
                            </button>
                        </Tooltip>
                    </div>
                </SettingsRow>
            )}
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
                        <Tooltip label={t('machine.access.revoke')}>
                            <button
                                className="icon-btn shrink-0"
                                aria-label={t('machine.access.revokeOne', { label: session.label })}
                                onClick={() => setTarget(session)}
                            >
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

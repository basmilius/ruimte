import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Trash } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { brokerUrlProblem, type BrokerSetting } from '@ruimte/pulsar';
import type { AuthSession, PeerLink, ReachCheck, RuntimeMode, TerminalShell } from '@ruimte/contracts';
import { RUNTIME_MODES, runtimeModeLabel } from '@adecore/agents-react/chat';
import { messageOf, Segmented, Select, Skeleton, Switch, Button, IconButton, Tooltip, FormError, Input, useNow } from '@adecore/ui';
import { formatNumericDate, formatAgo } from '@adecore/ui/format';
import { ConfirmDialog, SettingsRow } from '@adecore/ui/settings';
import { perform } from '@/actions/client-actions';
import { desktop, openInSystemBrowser } from '@/desktop/bridge';
import { forgetEndpoint } from '@/endpoint';
import { saveMachineSetting, useMachineSetting, type MachineSettingPatch } from '@/shell/settings/machine-setting';
import { reachText } from '@/shell/settings/reach-text';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { pool, transportFor, type Transport } from '@/transport';
import { useMachineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';

const MINUTE_MS = 60_000;

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

function MachineSettingSwitch({
    endpoint,
    reason,
    checked,
    label,
    patch
}: {
    endpoint: Endpoint;
    reason: string | null;
    checked: boolean;
    label: string;
    patch(checked: boolean): MachineSettingPatch;
}) {
    const { busy, save } = useMachineSetting(endpoint);

    return (
        <WithReason reason={reason}>
            <Switch checked={checked} onCheckedChange={(next) => void save(patch(next))} label={label} disabled={busy || reason !== null} />
        </WithReason>
    );
}

/*
 * Running the wire to this machine over a WebRTC DataChannel instead of its socket, an experiment; every
 * other machine is reached that way already. A direct connection that fails stays failed and says why,
 * never falling back to the socket.
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
const TERMINAL_SHELLS: readonly TerminalShell[] = ['powershell', 'git-bash', 'cmd', 'wsl'];

/* Which broker the machine announces itself to, a connection service to a person. It lives on the machine because the daemon is the one that dials it. */
export function BrokerRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const info = useServers((s) => s.byEndpoint[endpoint.id]);
    const setting = info?.broker;
    const [mode, setMode] = useState<BrokerMode>(setting?.mode ?? 'default');
    const [draft, setDraft] = useState(setting?.mode === 'custom' ? setting.url : '');
    const [problem, setProblem] = useState<string | null>(null);
    const { busy, save } = useMachineSetting(endpoint);
    const [shown, setShown] = useState(setting);

    // Another client may change it while the detail is open; the row follows the machine during render rather than a render later.
    if (shown !== setting) {
        setShown(setting);
        setMode(setting?.mode ?? 'default');
        setDraft(setting?.mode === 'custom' ? setting.url : '');
        setProblem(null);
    }

    const pick = (next: BrokerMode): void => {
        setMode(next);
        setProblem(null);
        // A custom broker needs its URL first; the field below saves it.
        if (next !== 'custom') {
            void save({ broker: { mode: next } });
        }
    };

    const saveCustom = (): void => {
        const url = draft.trim();
        const found = brokerUrlProblem(url);
        setProblem(found);
        if (found === null) {
            void save({ broker: { mode: 'custom', url } });
        }
    };

    const description = (): string => {
        if (reason !== null) {
            return t('machine.notAnswering');
        }
        const parts = [t('machine.broker.description')];
        if (!endpoint.brokerUrl) {
            parts.push(t('machine.broker.none'));
        }
        if (info?.brokerFixed) {
            parts.push(t('machine.broker.fixed'));
        }
        return parts.join(' ');
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
                        disabled={busy || reason !== null}
                    />
                </WithReason>
            }
        >
            {mode === 'custom' && reason === null && (
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
                            disabled={busy || draft.trim() === '' || (setting?.mode === 'custom' && draft.trim() === setting.url)}
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

/*
 * Whether the machine keeps its door on the local network open, so a client on the same network
 * reaches it without the broker. It lives on the machine because the daemon is the one that listens.
 */
export function LanDoorRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const kept = useServers((s) => s.byEndpoint[endpoint.id]?.lanDoor ?? true);
    const fixed = useServers((s) => s.byEndpoint[endpoint.id]?.lanDoorFixed === true);

    const description = (): string => {
        if (reason !== null) {
            return t('machine.notAnswering');
        }
        const lan = endpoint.lan ?? null;
        const where =
            lan === null
                ? t(kept ? 'machine.lanDoor.notListening' : 'machine.lanDoor.closed')
                : t(lan.addresses.length > 0 ? 'machine.lanDoor.open' : 'machine.lanDoor.noAddress');
        return fixed ? `${where} ${t('machine.lanDoor.fixedNote')}` : where;
    };

    return (
        <SettingsRow
            searchId="machines.machine.lanDoor"
            label={t('machine.lanDoor.label')}
            description={description()}
            control={
                <MachineSettingSwitch
                    endpoint={endpoint}
                    reason={reason ?? (fixed ? t('machine.lanDoor.fixed') : null)}
                    checked={kept}
                    label={t('machine.lanDoor.toggle', { machine: endpoint.label })}
                    patch={(lanDoor) => ({ lanDoor })}
                />
            }
        />
    );
}

type ReachState = { state: 'checking'; last: ReachCheck | null } | { state: 'done'; check: ReachCheck | null } | { state: 'failed'; message: string };

/*
 * Whether other devices reach the machine, as the machine checks it itself: what is wrong and what a
 * person can do about it. The machine checks when its broker takes it and when its network changed;
 * Check again asks it now.
 */
export function ReachRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const answers = useMachineAnswers(endpoint.id, 'endpoint.reach');
    const [reach, setReach] = useState<ReachState>({ state: 'checking', last: null });
    const [attempt, setAttempt] = useState<{ check: boolean; n: number }>({ check: false, n: 0 });
    const now = useNow(MINUTE_MS);

    useEffect(() => {
        const transport = transportFor(endpoint.id);
        if (!answers || reason !== null || transport === null) {
            return;
        }
        let current = true;
        transport.request('endpoint.reach', attempt.check ? { check: true } : {}).then(
            (answer) => current && setReach({ state: 'done', check: answer.reach }),
            (e: unknown) => current && setReach({ state: 'failed', message: messageOf(e) })
        );
        return () => {
            current = false;
        };
    }, [endpoint.id, answers, reason, attempt]);

    if (!answers) {
        return null;
    }
    const shown = reach.state === 'done' ? reach.check : reach.state === 'checking' ? reach.last : null;

    const description = (): ReactNode => {
        if (reason !== null) {
            return t('machine.notAnswering');
        }
        if (reach.state === 'failed') {
            return (
                <span className="text-status-error" role="alert">
                    {t('machine.reach.failed', { message: reach.message })}
                </span>
            );
        }
        if (shown === null) {
            return reach.state === 'checking' ? t('machine.reach.checking') : null;
        }
        const text = reachText(shown);
        const sentence = [text.problem, text.fix, t('machine.reach.checkedAt', { when: ago(shown.checkedAt, now) })].filter((part) => part !== null).join(' ');
        return shown.severity === 'unreachable' ? (
            <span className="text-status-error" role="alert">
                {sentence}
            </span>
        ) : (
            sentence
        );
    };

    return (
        <SettingsRow
            searchId="machines.machine.reach"
            label={t('machine.reach.label')}
            description={description()}
            control={
                <WithReason reason={reason}>
                    <Button
                        variant="secondary"
                        disabled={reason !== null || reach.state === 'checking'}
                        aria-label={t('machine.reach.checkAgainLabel', { machine: endpoint.label })}
                        onClick={() => {
                            setReach({ state: 'checking', last: shown });
                            setAttempt((before) => ({ check: true, n: before.n + 1 }));
                        }}
                    >
                        {t('machine.reach.checkAgain')}
                    </Button>
                </WithReason>
            }
        />
    );
}

/* One daemon policy covers today's browser stream and the device streams that will follow it. */
export function StreamingRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const allowed = useServers((s) => s.byEndpoint[endpoint.id]?.streamingAllowed ?? true);

    return (
        <SettingsRow
            searchId="machines.machine.streaming"
            label={t('machine.streaming.label')}
            description={reason !== null ? t('machine.notAnswering') : t('machine.streaming.description')}
            control={
                <MachineSettingSwitch
                    endpoint={endpoint}
                    reason={reason}
                    checked={allowed}
                    label={t('machine.streaming.toggle', { machine: endpoint.label })}
                    patch={(streamingAllowed) => ({ streamingAllowed })}
                />
            }
        />
    );
}

const PRIVACY_URL = 'https://ruimte.app/privacy';

function openPrivacy(): void {
    openInSystemBrowser(PRIVACY_URL);
}

/*
 * Whether the machine sends its anonymous daily usage counts. Only the app on the machine may change it,
 * so the row is not drawn for another machine, nor for one from before the switch.
 */
export function UsageStatsRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const on = useServers((s) => s.byEndpoint[endpoint.id]?.usageStats ?? true);

    return (
        <SettingsRow
            searchId="machines.machine.usageStats"
            label={t('machine.usageStats.label')}
            description={
                reason !== null ? (
                    t('machine.notAnswering')
                ) : (
                    <Trans
                        t={t}
                        i18nKey="machine.usageStats.description"
                        components={{ privacy: <button type="button" className="text-accent hover:underline" onClick={openPrivacy} /> }}
                    />
                )
            }
            control={
                <MachineSettingSwitch
                    endpoint={endpoint}
                    reason={reason}
                    checked={on}
                    label={t('machine.usageStats.toggle', { machine: endpoint.label })}
                    patch={(usageStats) => ({ usageStats })}
                />
            }
        />
    );
}

function ago(timestamp: number, now: number): string {
    return formatAgo(now - timestamp);
}

type ListWords = 'machine.access' | 'machine.links';

/* A list the machine behind the socket keeps, so it loads again on every reconnect. */
function useMachineList<Item>(endpointId: string, enabled: boolean, read: (transport: Transport) => Promise<Item[]>, words: ListWords) {
    const { t } = useTranslation('settings');
    const status = useEndpointConnection(endpointId).status;
    const [items, setItems] = useState<Item[] | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    const load = (): void => {
        const transport = transportFor(endpointId);

        if (!transport) {
            return;
        }

        read(transport)
            .then((next) => {
                setItems(next);
                setFailure(null);
            })
            .catch((e: unknown) => setFailure(messageOf(e, t(`${words}.listFailed`))));
    };

    useEffect(() => {
        if (status === 'open' && enabled) {
            load();
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [status, enabled, endpointId]);

    return { open: status === 'open', items, failure, setFailure, load };
}

/* The section around such a list, with what it shows while the machine is silent, loading, empty or failed. */
function MachineListSection({
    words,
    open,
    items,
    failure,
    children
}: {
    words: ListWords;
    open: boolean;
    items: readonly unknown[] | null;
    failure: string | null;
    children: ReactNode;
}) {
    const { t } = useTranslation('settings');
    const waiting = items === null && failure === null;

    return (
        <SettingsSection title={t(`${words}.title`)} description={t(`${words}.description`)}>
            {!open && waiting && <SettingsRow muted label={t(`${words}.silent.label`)} description={t(`${words}.silent.description`)} />}
            {open && waiting && <SettingsRow label={<Skeleton className="w-40" />} control={<Skeleton className="w-8" />} />}
            {items?.length === 0 && <SettingsRow muted label={t(`${words}.empty`)} />}
            {children}
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
        </SettingsSection>
    );
}

async function readSessions(transport: Transport): Promise<AuthSession[]> {
    return (await transport.request('auth.sessions', {})).sessions;
}

async function readLinks(transport: Transport): Promise<PeerLink[]> {
    return (await transport.request('peer.list', {})).links;
}

/* The browsers and apps one machine let in, each with a way to cut it off. */
export function MachineAccess({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const reachability = useServers((s) => s.byEndpoint[endpoint.id]?.reachability ?? endpoint.reachability);
    const { open, items: sessions, failure, load } = useMachineList(endpoint.id, true, readSessions, 'machine.access');
    const [target, setTarget] = useState<AuthSession | null>(null);
    const now = useNow(MINUTE_MS);

    const revoke = async (): Promise<void> => {
        const session = target;
        if (!session || !transportFor(endpoint.id)) {
            return;
        }
        await perform('machine.revokeAccess', { endpointId: endpoint.id, sessionId: session.id });
        if (session.current) {
            // Revoking this client's own access leaves a row that can no longer get in.
            await forgetEndpoint(endpoint.id);
            return;
        }
        load();
    };

    /*
     * On this machine your own client gets in with the local secret, so its row is left out. On another
     * machine it stays, since revoking it is the way to hand your own access back.
     */
    const listed = reachability === 'loopback' ? (sessions?.filter((session) => !session.current) ?? null) : sessions;

    return (
        <MachineListSection words="machine.access" open={open} items={listed} failure={failure}>
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
                        origin:
                            session.machineId !== undefined
                                ? t('machine.access.origin.machine')
                                : session.origin === 'statement'
                                  ? t('machine.access.origin.statement')
                                  : t('machine.access.origin.link'),
                        date: formatNumericDate(session.createdAt),
                        ago: ago(session.lastSeenAt, now)
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
            <ConfirmDialog
                open={target !== null}
                onOpenChange={(next) => (next ? undefined : setTarget(null))}
                title={t('machine.access.confirm.title', { label: target?.label ?? t('machine.access.thisClient') })}
                description={
                    target?.current
                        ? t('machine.access.confirm.current')
                        : target?.machineId !== undefined
                          ? t('machine.access.confirm.machine')
                          : target?.origin === 'statement'
                            ? t('machine.access.confirm.statement')
                            : t('machine.access.confirm.link')
                }
                confirmLabel={t('machine.access.confirm.action')}
                onConfirm={revoke}
            />
        </MachineListSection>
    );
}

/* The projects on this machine that another machine of the account works in, each with the widest mode its agents may start in and a way to cut the link. */
export function MachineLinks({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const answers = useMachineAnswers(endpoint.id, 'peer.list');
    const { open, items: links, failure, setFailure, load } = useMachineList(endpoint.id, answers, readLinks, 'machine.links');
    const [target, setTarget] = useState<PeerLink | null>(null);
    const now = useNow(MINUTE_MS);

    useEffect(() => {
        if (!answers) {
            return;
        }
        return transportFor(endpoint.id)?.on('peer.changed', load);
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [answers, endpoint.id]);

    const change = async (request: Promise<unknown> | undefined, failedKey: string): Promise<void> => {
        try {
            await request;
            setFailure(null);
        } catch (e) {
            setFailure(messageOf(e, t(failedKey)));
        }

        load();
    };

    const setCeiling = (link: PeerLink, ceiling: RuntimeMode): Promise<void> =>
        change(
            transportFor(endpoint.id)?.request('peer.setCeiling', { machineId: link.machineId, projectId: link.projectId, ceiling }),
            'machine.links.changeFailed'
        );

    const unlink = async (): Promise<void> => {
        if (target) {
            await change(
                transportFor(endpoint.id)?.request('peer.unbind', { machineId: target.machineId, projectId: target.projectId }),
                'machine.links.unlinkFailed'
            );
        }
    };

    if (!answers && open) {
        return null;
    }

    const modes = RUNTIME_MODES.map((mode) => ({ value: mode, label: runtimeModeLabel(mode) }));

    return (
        <MachineListSection words="machine.links" open={open} items={links} failure={failure}>
            {links?.map((link) => (
                <SettingsRow
                    key={`${link.machineId}/${link.projectId}`}
                    label={
                        <span className="break-words">
                            {link.projectName === '' ? link.projectId : link.projectName}
                            <span className="ml-1.5 text-xs text-text-muted">{t('machine.links.from', { machine: link.label })}</span>
                        </span>
                    }
                    description={t(link.lastUsedAt === undefined ? 'machine.links.unused' : 'machine.links.used', {
                        machine: link.label,
                        date: formatNumericDate(link.createdAt),
                        ago: link.lastUsedAt === undefined ? '' : ago(link.lastUsedAt, now)
                    })}
                    control={
                        <div className="flex shrink-0 items-center gap-1">
                            <Select<RuntimeMode>
                                label={t('machine.links.ceiling', { machine: link.label })}
                                variant="outlined"
                                value={link.ceiling}
                                onValueChange={(ceiling) => void setCeiling(link, ceiling)}
                                items={modes}
                            />
                            <IconButton
                                icon={Trash}
                                label={t('machine.links.unlinkOne', {
                                    project: link.projectName === '' ? link.projectId : link.projectName,
                                    machine: link.label
                                })}
                                tooltip={t('machine.links.unlink')}
                                onClick={() => setTarget(link)}
                            />
                        </div>
                    }
                />
            ))}
            <ConfirmDialog
                open={target !== null}
                onOpenChange={(next) => (next ? undefined : setTarget(null))}
                title={t('machine.links.confirm.title', { project: target?.projectName ?? '', machine: target?.label ?? '' })}
                description={t('machine.links.confirm.text', { machine: target?.label ?? '' })}
                confirmLabel={t('machine.links.confirm.action')}
                onConfirm={unlink}
            />
        </MachineListSection>
    );
}

/* The shell of a new terminal on this Windows machine. An open terminal keeps the one it started in. */
export function TerminalShellRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const chosen = useServers((s) => s.byEndpoint[endpoint.id]?.terminalShell) ?? 'powershell';
    const [problem, setProblem] = useState<string | null>(null);
    return (
        <SettingsRow
            searchId="terminal.shell"
            label={t('machine.terminalShell.label')}
            description={t('machine.terminalShell.description')}
            control={
                <WithReason reason={reason}>
                    <Select<TerminalShell>
                        label={t('machine.terminalShell.label')}
                        variant="outlined"
                        value={chosen}
                        disabled={reason !== null}
                        onValueChange={(terminalShell) => void saveMachineSetting(endpoint, { terminalShell }, setProblem)}
                        items={TERMINAL_SHELLS.map((id) => ({ value: id, label: t(`machine.terminalShell.options.${id}`) }))}
                    />
                </WithReason>
            }
        >
            {problem !== null && <FormError>{problem}</FormError>}
        </SettingsRow>
    );
}

/*
 * Where this machine makes new worktrees. Worktrees already made stay where they are. Only the app on
 * the machine may set it, so the row is not drawn for another machine.
 */
export function WorktreeFolderRow({ endpoint, reason }: { endpoint: Endpoint; reason: string | null }) {
    const { t } = useTranslation('settings');
    const kept = useServers((s) => s.byEndpoint[endpoint.id]?.worktreeRoot);
    const [draft, setDraft] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    // Enter saves and the field then loses focus: the blur must not save the same value again.
    const saving = useRef(false);
    const pickFolder = desktop()?.pickFolder;
    const shown = draft ?? kept ?? '';

    const save = async (value: string): Promise<void> => {
        if (saving.current) {
            return;
        }
        if (value.trim() === (kept ?? '')) {
            setDraft(null);
            return;
        }
        saving.current = true;
        setBusy(true);
        setProblem(null);
        const saved = await saveMachineSetting(endpoint, { worktreeRoot: value.trim() }, setProblem);
        saving.current = false;
        setBusy(false);
        if (saved) {
            setDraft(null);
        }
    };

    const choose = async (): Promise<void> => {
        const picked = await pickFolder?.(kept ?? undefined);
        if (picked) {
            setDraft(picked);
            await save(picked);
        }
    };

    const canReset = kept !== null && kept !== undefined;
    return (
        <SettingsRow
            searchId="files.worktreeFolder"
            label={t('machine.worktreeFolder.label')}
            description={
                canReset
                    ? t('machine.worktreeFolder.descriptionChosen')
                    : t(pickFolder ? 'machine.worktreeFolder.description' : 'machine.worktreeFolder.descriptionTyped')
            }
            control={
                pickFolder || canReset ? (
                    <WithReason reason={reason}>
                        <span className="flex items-center gap-2">
                            {pickFolder && (
                                <Button variant="secondary" disabled={busy || reason !== null} onClick={() => void choose()}>
                                    {t('machine.worktreeFolder.choose')}
                                </Button>
                            )}
                            {canReset && (
                                <Button variant="secondary" disabled={busy || reason !== null} onClick={() => void save('')}>
                                    {t('machine.worktreeFolder.reset')}
                                </Button>
                            )}
                        </span>
                    </WithReason>
                ) : undefined
            }
        >
            <div className="flex min-w-0 flex-col gap-1">
                <Input
                    mono
                    className="w-full min-w-0"
                    value={shown}
                    placeholder={t('machine.worktreeFolder.placeholder')}
                    aria-label={t('machine.worktreeFolder.label')}
                    spellCheck={false}
                    disabled={busy || reason !== null}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setProblem(null);
                    }}
                    onBlur={() => void save(shown)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                            void save(shown);
                        }
                    }}
                />
                {problem !== null && <FormError className="break-words">{problem}</FormError>}
            </div>
        </SettingsRow>
    );
}

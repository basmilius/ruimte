import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { Check, Copy, Link2, Pencil, Plus, Trash } from 'lucide-react';
import type { AuthSession, ProjectIconChoice } from '@ruimte/contracts';
import { forgetEndpoint, listPairedClients, pairEndpoint, requestPairingUrl, revokePairedClient } from '@/endpoint';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { LOCAL_ENDPOINT_ID, localMachineLabel, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServer, useServers } from '@/state/server';
import { pool, transport, type TransportStatus } from '@/transport';
import { useLatency } from '@/transport/ping';
import { useEndpointConnection } from '@/transport/status';
import { describeConnection, describePing, REACHABILITY_LABELS } from '@/shell/connection-info';
import { MachineIdentityDialog } from '@/shell/settings/MachineIdentityDialog';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Skeleton } from '@/shell/settings/controls';
import { Button } from '@/ui/Button';
import { BTN_GROUP } from '@/ui/classes';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

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

const failureText = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

const DOT: Record<TransportStatus, string> = {
    open: 'bg-status-idle',
    connecting: 'bg-status-needs-you',
    closed: 'bg-status-error'
};

/*
 * The whole of a row's connection in one dot: whether the machine answers, and behind it the things
 * that only matter when it does not. The address left the row for this tooltip because it is a hint
 * about where a machine last answered, not what the machine is; a list of them reads as a list of
 * URLs rather than of machines.
 */
function EndpointState({ endpoint }: { endpoint: Endpoint }) {
    const connection = useEndpointConnection(endpoint.id);
    const latency = useLatency(endpoint.id);
    const reachability = useServers((s) => s.byEndpoint[endpoint.id]?.reachability ?? endpoint.reachability);

    const tooltip = (
        <span className="flex flex-col items-start gap-0.5">
            <span>{describeConnection(connection, null)}</span>
            <span className="text-text-muted">{REACHABILITY_LABELS[reachability]}</span>
            <span className="font-mono text-text-muted">{endpoint.httpBaseUrl}</span>
            <span className="text-text-muted">{describePing(latency)}</span>
        </span>
    );

    return (
        <Tooltip label={tooltip}>
            <span className="grid h-8 w-5 shrink-0 place-items-center" role="status" aria-label={`${endpoint.label}. ${describeConnection(connection, null)}`}>
                <span className={clsx('h-2 w-2 rounded-full', DOT[connection.status])} />
            </span>
        </Tooltip>
    );
}

/*
 * The name of a machine with its icon in front and a second line under it. The stack sits inside the
 * row's label rather than in the row's own description, so the line lands under the name instead of
 * under the glyph.
 */
function MachineName({ icon, name, note }: { icon: ProjectIconChoice | null; name: string; note?: ReactNode }) {
    return (
        <span className="flex items-center gap-2">
            <MachineGlyph icon={icon} className="shrink-0 text-text-muted" />
            <span className="flex min-w-0 flex-col">
                <span className="truncate">{name}</span>
                {note !== undefined && <span className="truncate text-xs text-text-faint">{note}</span>}
            </span>
        </span>
    );
}

/* A machine that was added here: what it is called, whether it answers, and what can be done to it. */
function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
    const mismatch = useEndpoints((s) => s.mismatched[endpoint.id]);
    const icon = useServers((s) => s.byEndpoint[endpoint.id]?.icon ?? null);
    const connected = useEndpointConnection(endpoint.id).status === 'open';
    const [identityOpen, setIdentityOpen] = useState(false);

    return (
        <SettingsRow
            label={
                <MachineName
                    icon={icon}
                    name={endpoint.label}
                    note={
                        mismatch === undefined ? undefined : (
                            <span className="text-status-error">A different machine answers at this address. Pair again to connect.</span>
                        )
                    }
                />
            }
            control={
                <>
                    <EndpointState endpoint={endpoint} />
                    <span className={BTN_GROUP}>
                        {/* The name and the icon live on the machine, so a machine that is not answering cannot be given either. */}
                        <Tooltip label={connected ? 'Name and icon' : 'Available once the machine answers'} name>
                            <button className="icon-btn h-8 w-8" disabled={!connected} onClick={() => setIdentityOpen(true)}>
                                <Icon icon={Pencil} size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip label="Forget this machine" name>
                            <button className="icon-btn h-8 w-8" onClick={() => void forgetEndpoint(endpoint.id)}>
                                <Icon icon={Trash} size={16} />
                            </button>
                        </Tooltip>
                    </span>
                    <MachineIdentityDialog endpointId={endpoint.id} label={endpoint.label} open={identityOpen} onOpenChange={setIdentityOpen} />
                </>
            }
        />
    );
}

/* A pairing link that names the loopback address can only be a machine that nobody else can reach. */
const onlyLoopback = (link: string): boolean => {
    try {
        const host = new URL(link).hostname;
        return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
    } catch {
        return false;
    }
};

/* The browsers and apps that paired with the active machine, each with a way to cut it off, and for the machine here a way to invite one. */
function PairedClients() {
    const reachability = useServer((s) => s.reachability);
    const [sessions, setSessions] = useState<AuthSession[] | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [target, setTarget] = useState<AuthSession | null>(null);
    const [busy, setBusy] = useState(false);
    const [link, setLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const load = (): void => {
        listPairedClients()
            .then((list) => {
                setSessions(list);
                setFailure(null);
            })
            .catch((e: unknown) => setFailure(failureText(e, 'Could not list paired clients')));
    };

    // The list belongs to the machine behind the socket, so it loads again on every reconnect; a switch remounts this whole block.
    useEffect(() => {
        if (transport.status === 'open') {
            load();
        }
        return transport.subscribeStatus((status) => {
            if (status === 'open') {
                load();
            }
        });
    }, []);

    const revoke = async (): Promise<void> => {
        if (!target) {
            return;
        }
        setBusy(true);
        try {
            await revokePairedClient(target);
            setTarget(null);
            load();
        } catch (e) {
            setFailure(failureText(e, 'Could not revoke this client'));
            setTarget(null);
        } finally {
            setBusy(false);
        }
    };

    const showLink = async (): Promise<void> => {
        setBusy(true);
        try {
            setLink(await requestPairingUrl());
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
     * one way to hand your own access back to that daemon, and forgetting a machine only drops what
     * this client keeps, never the session the daemon holds.
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
                    <Button variant="secondary" disabled={busy} onClick={() => void showLink()}>
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
                            : 'Paste it in the Machines settings on the other machine. It works once and expires after ten minutes.'
                    }
                >
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken p-2.5">
                        <code className="min-w-0 grow truncate font-mono text-code text-text select-text">{link}</code>
                        <Tooltip label={copied ? 'Copied' : 'Copy pairing link'} name>
                            <button className="icon-btn h-7 w-7 shrink-0" onClick={copyLink}>
                                {copied ? <Icon icon={Check} size={16} /> : <Icon icon={Copy} size={16} />}
                            </button>
                        </Tooltip>
                    </div>
                </SettingsRow>
            )}
            {listed === null && failure === null && <SettingsRow label={<Skeleton className="w-40" />} control={<Skeleton className="w-8" />} />}
            {listed?.length === 0 && <SettingsRow muted label="Nothing else has access to this machine." />}
            {listed?.map((session) => (
                <SettingsRow
                    key={session.id}
                    label={
                        <span className="truncate">
                            {session.label}
                            {session.current && <span className="ml-1.5 text-xs text-accent">this client</span>}
                        </span>
                    }
                    description={`Paired ${new Date(session.createdAt).toLocaleDateString()}, last seen ${ago(session.lastSeenAt)}`}
                    control={
                        <Tooltip label="Revoke access">
                            <button className="icon-btn h-8 w-8 shrink-0" aria-label={`Revoke ${session.label}`} onClick={() => setTarget(session)}>
                                <Icon icon={Trash} size={16} />
                            </button>
                        </Tooltip>
                    }
                />
            ))}
            {failure && <SettingsRow muted label={<span className="text-status-error">{failure}</span>} />}
            <Dialog.Root open={target !== null} onOpenChange={(open) => (open ? undefined : setTarget(null))}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop dialog-backdrop-nested" forceRender />
                    <Dialog.Popup className="dialog-popup dialog-popup-nested w-[380px] p-5">
                        <Dialog.Title className="text-base font-semibold text-text">Revoke {target?.label}?</Dialog.Title>
                        <p className="mt-1 text-xs text-text-muted">
                            {target?.current
                                ? 'This is the client you are using. It loses access to this machine and switches back to the machine it runs on. Pair again to regain access.'
                                : 'It loses access the next time it connects. Pairing again needs a new link.'}
                        </p>
                        <div className="mt-4 flex items-center justify-end gap-2">
                            <Button onClick={() => setTarget(null)}>Cancel</Button>
                            <Button variant="danger" disabled={busy} onClick={() => void revoke()}>
                                <Icon icon={Trash} size={12} /> Revoke
                            </Button>
                        </div>
                    </Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>
        </SettingsSection>
    );
}

/*
 * Adding a machine, in a dialog rather than a field that is always on screen: pairing happens once
 * per machine and the list is what the pane is for.
 *
 * The shape is a list of ways to add one, of which a pairing link is the first. A phone or a tablet
 * is the second, once there is a mobile app: it cannot paste a link this client typed, so it will
 * want a code or a QR of its own. Keeping the dialog about "a machine" rather than about "a pairing
 * link" is what leaves room for that without renaming anything a person has learned.
 */
function AddMachineDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
    const [link, setLink] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const pair = async (): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            // Pairing adds the machine and connects to it; where the work happens is decided by opening a project.
            await pairEndpoint(link);
            setLink('');
            onOpenChange(false);
        } catch (e) {
            setFailure(failureText(e, 'Pairing failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop dialog-backdrop-nested" forceRender />
                <Dialog.Popup className="dialog-popup dialog-popup-nested w-[460px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">Add a machine</Dialog.Title>
                    <p className="mt-1 text-xs text-text-muted">Paste a pairing link from the other machine.</p>
                    <div className="mt-3 flex items-center gap-2">
                        <input
                            autoFocus
                            className="field min-w-0 grow font-mono text-code"
                            aria-label="Pairing link"
                            placeholder="http://machine:4210/pair#token"
                            value={link}
                            spellCheck={false}
                            onChange={(e) => setLink(e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter' && link.trim()) {
                                    void pair();
                                }
                            }}
                        />
                    </div>
                    <p className="mt-1.5 text-xs text-text-faint">Find it under "Show pairing link" in its settings, or run `ruimte pair` there.</p>
                    {failure && (
                        <p className="mt-2 text-xs text-status-error" role="alert">
                            {failure}
                        </p>
                    )}
                    <div className="mt-4 flex items-center justify-end gap-2">
                        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button variant="primary" disabled={busy || !link.trim()} onClick={() => void pair()}>
                            <Icon icon={Link2} size={12} /> Pair
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/*
 * The machine the app runs on: where you are, not something you connected to. It has no dot, no
 * address and no way to forget it, because none of those are a choice anyone has here. What it does
 * keep is its name and its icon: the moment a second machine is on the list, this is what tells the
 * two apart, in the switcher and in every menu that names a machine.
 */
function LocalRow({ endpoint }: { endpoint: Endpoint }) {
    const icon = useServers((s) => s.byEndpoint[endpoint.id]?.icon ?? null);
    const model = useServers((s) => s.byEndpoint[endpoint.id]?.model ?? null);
    const connected = useEndpointConnection(endpoint.id).status === 'open';
    const [identityOpen, setIdentityOpen] = useState(false);
    const own = localMachineLabel(model);

    return (
        <SettingsRow
            /* The second line only once the machine carries a name of its own, or it would say what the one above it says. */
            label={<MachineName icon={icon} name={endpoint.label} note={endpoint.label === own ? undefined : own} />}
            control={
                <>
                    <Tooltip label={connected ? 'Name and icon' : 'Available once the machine answers'} name>
                        <button className="icon-btn h-8 w-8" disabled={!connected} onClick={() => setIdentityOpen(true)}>
                            <Icon icon={Pencil} size={16} />
                        </button>
                    </Tooltip>
                    <MachineIdentityDialog endpointId={endpoint.id} label={endpoint.label} open={identityOpen} onOpenChange={setIdentityOpen} />
                </>
            }
        />
    );
}

/* The machines this client knows, in the sections the rest of the settings screen is built from. */
export function EndpointsSection() {
    const endpoints = useEndpoints((s) => s.endpoints);
    const activeId = useEndpoints((s) => s.activeId);
    const [addOpen, setAddOpen] = useState(false);

    // Every machine on the list keeps a socket while the pane is open, which is what the dots read.
    useEffect(() => {
        const released = endpoints.map((endpoint: Endpoint) => pool.hold(endpoint));
        return () => {
            for (const release of released) {
                release();
            }
        };
    }, [endpoints]);

    const local = endpoints.find((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID) ?? null;
    const others = endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID);

    return (
        <>
            {/* Its own section rather than the first row of the list below: where you are is not one more
                server, and a heading of the same kind as the rest is what keeps that clear on a screen
                where every other group has one. */}
            {local && (
                <SettingsSection title="This machine" description="The machine this app runs on.">
                    <LocalRow endpoint={local} />
                </SettingsSection>
            )}
            {/* "Other" rather than "added", "paired" or "remote": it reads against the section above it,
                it says nothing about how a machine got here, and it stays true for one that is switched off. */}
            <SettingsSection
                title="Other machines"
                description="Each machine keeps its own sessions, projects and files. Open a project on it to work there."
                action={
                    <Tooltip label="Add a machine" name>
                        <button className="icon-btn h-8 w-8" onClick={() => setAddOpen(true)}>
                            <Icon icon={Plus} size={16} />
                        </button>
                    </Tooltip>
                }
            >
                {others.length === 0 && (
                    <SettingsRow muted label="No other machines" description="Add one to open its projects, terminals and agents from here." />
                )}
                {others.map((endpoint) => (
                    <EndpointRow key={endpoint.id} endpoint={endpoint} />
                ))}
            </SettingsSection>
            <PairedClients key={activeId} />
            <AddMachineDialog open={addOpen} onOpenChange={setAddOpen} />
        </>
    );
}

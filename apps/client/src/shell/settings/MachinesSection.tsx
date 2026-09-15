import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { ChevronRight, KeyRound, Link2, LogIn, LogOut, Plus } from 'lucide-react';
import { LinkMachineDialog } from '@/shell/LinkMachineDialog';
import { pairEndpoint } from '@/endpoint';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { cancelPulsarSignIn, messageOf, signInToPulsar, signOutOfPulsar, usePulsarAccount } from '@/pulsar/account';
import { forgetAccountMachines, reclaimAfterPairing, refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { describeConnection, describeLastSeen, describePing, REACHABILITY_LABELS } from '@/shell/connection-info';
import { MachineDialog } from '@/shell/settings/MachineDialog';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Skeleton } from '@/shell/settings/controls';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { mergeMachines, nameOf, reachLabel, type MachineEntry } from '@/shell/settings/machine-list';
import { brokerRouteOf, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { hasLocalMachine } from '@/state/local-machine';
import type { TransportStatus } from '@/transport';
import { useMinute } from '@/shell/usage/limits';
import { useLatency } from '@/transport/ping';
import { useEndpointConnection, useLastSeenAt } from '@/transport/status';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const DOT: Record<TransportStatus, string> = {
    open: 'bg-status-idle',
    connecting: 'bg-status-needs-you',
    closed: 'bg-status-error'
};

/*
 * The whole of a row's connection in one dot: whether the machine answers, and behind it the things
 * that only matter when it does not. The address sits in this tooltip because it is a hint about
 * where a machine last answered, not what the machine is.
 */
function ConnectionDot({ endpoint }: { endpoint: Endpoint }) {
    const connection = useEndpointConnection(endpoint.id);
    const latency = useLatency(endpoint.id);
    const lastSeenAt = useLastSeenAt(endpoint.id);
    const reachability = useServers((s) => s.byEndpoint[endpoint.id]?.reachability ?? endpoint.reachability);
    const now = useMinute();
    const lastSeen = connection.noLink === true ? describeLastSeen(lastSeenAt, now) : null;

    const tooltip = (
        <span className="flex flex-col items-start gap-0.5">
            <span>{describeConnection(connection, null)}</span>
            {lastSeen !== null && <span className="text-text-muted">{lastSeen}</span>}
            <span className="text-text-muted">{REACHABILITY_LABELS[reachability]}</span>
            <span className="font-mono text-text-muted">{endpoint.httpBaseUrl === '' ? 'Reached through the broker only' : endpoint.httpBaseUrl}</span>
            {endpoint.direct === true && (
                <span className="text-text-muted">
                    {brokerRouteOf(endpoint) === null ? 'Direct connection (experimental)' : 'Direct connection through the broker (experimental)'}
                </span>
            )}
            <span className="text-text-muted">{describePing(latency)}</span>
        </span>
    );

    return (
        <Tooltip label={tooltip}>
            <span className="grid h-8 w-6 shrink-0 place-items-center" role="status" aria-label={`${endpoint.label}. ${describeConnection(connection, null)}`}>
                <span className={clsx('h-2 w-2 rounded-full', connection.noLink === true ? 'border border-border-strong' : DOT[connection.status])} />
            </span>
        </Tooltip>
    );
}

/* A machine only the account knows has no connection here, which a hollow dot says without a color. */
function NotOpenedDot({ name }: { name: string }) {
    return (
        <Tooltip label="Not opened on this client">
            <span className="grid h-8 w-6 shrink-0 place-items-center" role="status" aria-label={`${name}. Not opened on this client`}>
                <span className="h-2 w-2 rounded-full border border-border-strong" />
            </span>
        </Tooltip>
    );
}

/* Why this client cannot reach the machine the way it should, for the line under the name. */
const useRowFailure = (endpoint: Endpoint | null): string | null => {
    const mismatch = useEndpoints((s) => (endpoint ? s.mismatched[endpoint.id] : undefined));
    const connection = useEndpointConnection(endpoint?.id ?? '');
    if (endpoint === null) {
        return null;
    }
    if (mismatch !== undefined) {
        return 'A different machine answers at this address. Pair again to connect.';
    }
    // A socket reports a failure only for a refusal (another wire version), so any failure is worth the line.
    return connection.status !== 'open' ? (connection.failure ?? null) : null;
};

function MachineRow({ entry, onOpen }: { entry: MachineEntry; onOpen(): void }) {
    const icon = useMachineIcon(entry);
    const failure = useRowFailure(entry.endpoint);
    const relayed = useEndpointConnection(entry.endpoint?.id ?? '').relayed === true;
    const name = nameOf(entry);

    return (
        <div className="flex min-w-0 items-center gap-1 py-1 pr-3 pl-1.5">
            <button
                type="button"
                className="flex min-w-0 grow items-center gap-3 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={`${name}, ${reachLabel(entry)}`}
                onClick={onOpen}
            >
                <MachineGlyph icon={icon} className="shrink-0 text-text-muted" />
                <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-sm text-text">{name}</span>
                    <span className="text-xs leading-snug break-words text-text-faint">{relayed ? `${reachLabel(entry)} · via relay` : reachLabel(entry)}</span>
                    {failure !== null && <span className="text-xs leading-snug break-words text-status-error">{failure}</span>}
                </span>
                <Icon icon={ChevronRight} size={16} className="shrink-0 text-text-faint" />
            </button>
            {entry.endpoint ? <ConnectionDot endpoint={entry.endpoint} /> : <NotOpenedDot name={name} />}
        </div>
    );
}

/* Signing in is what lets a client reach a machine it never paired with: the account vouches for this client's key. */
function AccountRows() {
    const status = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const error = usePulsarAccount((s) => s.error);
    const notice = usePulsarAccount((s) => s.notice);

    return (
        <>
            {status === 'unavailable' && (
                <SettingsRow
                    muted
                    label="Signing in works in the desktop app and at station.ruimte.app."
                    description="The account sends a sign-in back to those places only."
                />
            )}
            {status === 'loading' && <SettingsRow label={<Skeleton className="w-40" />} control={<Skeleton className="w-20" />} />}
            {status === 'signed-out' && (
                <SettingsRow
                    label="Not signed in"
                    description={
                        notice ?? 'Signing in opens GitHub. Machines you reach while signed in join your account on their own, and its machines show up here.'
                    }
                    control={
                        <Button variant="primary" onClick={() => void signInToPulsar()}>
                            <Icon icon={LogIn} size={12} /> Sign in with GitHub
                        </Button>
                    }
                />
            )}
            {status === 'signing-in' && (
                <SettingsRow
                    label="Signing in"
                    description="Finish signing in with GitHub, then come back here."
                    control={<Button onClick={() => void cancelPulsarSignIn()}>Cancel</Button>}
                />
            )}
            {status === 'signed-in' && account && (
                <SettingsRow
                    label={account.login === null ? 'Signed in with GitHub' : `Signed in as ${account.login}`}
                    description="Anyone who takes over this GitHub account can reach your machines, so turn on two-factor authentication there."
                    control={
                        <Button onClick={() => void signOutOfPulsar()}>
                            <Icon icon={LogOut} size={12} /> Sign out
                        </Button>
                    }
                />
            )}
            {error !== null && <SettingsRow muted label={<span className="break-words text-status-error">{error}</span>} />}
        </>
    );
}

/*
 * Adding a machine, in a dialog rather than a field that is always on screen: pairing happens once
 * per machine and the list is what the pane is for. The dialog is about "a machine" rather than "a
 * pairing link", which leaves room for a second way in (a code for a phone) without renaming anything.
 */
function AddMachineDialog({ open, onOpenChange, onLinkWithCode }: { open: boolean; onOpenChange(open: boolean): void; onLinkWithCode(): void }) {
    const [link, setLink] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const pair = async (): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            const record = await pairEndpoint(link);
            setLink('');
            onOpenChange(false);
            reclaimAfterPairing(record).catch((e: unknown) => {
                useToasts.getState().show({
                    id: `machine-reclaim-${record.id}`,
                    kind: 'error',
                    title: `${record.label} is paired, but not back on your account`,
                    description: messageOf(e)
                });
            });
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'Pairing failed');
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
                    <Dialog.Description className="mt-1 text-xs text-text-muted">Paste a pairing link from the other machine.</Dialog.Description>
                    <input
                        autoFocus
                        className="field mt-3 min-w-0 font-mono text-code"
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
                    <p className="mt-1.5 text-xs break-words text-text-faint">
                        Find it under Show pairing link in that machine's dialog, or run `ruimte pair` there. A machine someone removed from your account goes
                        back on it when you pair while signed in.
                    </p>
                    {failure && (
                        <p className="mt-2 text-xs break-words text-status-error" role="alert">
                            {failure}
                        </p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                        <Tooltip label="For a machine without the app that ran `ruimte login`">
                            <Button className="mr-auto" onClick={onLinkWithCode}>
                                <Icon icon={KeyRound} size={12} /> Link a machine with a code
                            </Button>
                        </Tooltip>
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
 * One list of machines: the rows of this client (this machine, and every machine paired by link)
 * joined with the machines on the account, one entry per machine id. Everything that can be done to
 * a machine lives in its dialog, so the list stays a list of machines rather than of controls.
 */
export function MachinesSection() {
    const endpoints = useEndpoints((s) => s.endpoints);
    const status = usePulsarAccount((s) => s.status);
    const machines = usePulsarMachines((s) => s.machines);
    const machinesError = usePulsarMachines((s) => s.error);
    const [addOpen, setAddOpen] = useState(false);
    const [linkOpen, setLinkOpen] = useState(false);
    const [dialog, setDialog] = useState<{ id: string; open: boolean } | null>(null);

    // An open pane is one of the moments a client learns what the account says, removals included.
    useEffect(() => {
        if (status === 'signed-in') {
            void refreshAccountMachines();
        } else if (status === 'signed-out') {
            forgetAccountMachines();
        }
    }, [status]);

    const signedIn = status === 'signed-in';
    const entries = mergeMachines({ endpoints, accountMachines: signedIn ? machines : null, showLocal: hasLocalMachine() });
    const selected = dialog === null ? null : (entries.find((entry) => entry.id === dialog.id) ?? null);

    return (
        <>
            <SettingsSection title="Account" description="Machines on your account open from any client you sign in on.">
                <AccountRows />
            </SettingsSection>
            <SettingsSection
                title="Machines"
                description="Each machine keeps its own sessions, projects and files. Open a project on it to work there."
                action={
                    <Button variant="secondary" onClick={() => setAddOpen(true)}>
                        <Icon icon={Plus} size={12} /> Add a machine
                    </Button>
                }
            >
                {entries.length === 0 && (
                    <SettingsRow muted label="No machines yet" description="Add one to open its projects, terminals and agents from here." />
                )}
                {entries.map((entry) => (
                    <MachineRow key={entry.id} entry={entry} onOpen={() => setDialog({ id: entry.id, open: true })} />
                ))}
                {signedIn && machines === null && machinesError === null && (
                    <SettingsRow label={<Skeleton className="w-40" />} description={<Skeleton className="mt-1 w-24" />} />
                )}
                {signedIn && machinesError !== null && <SettingsRow muted label={<span className="break-words text-status-error">{machinesError}</span>} />}
            </SettingsSection>
            <MachineDialog
                entry={selected}
                open={dialog?.open === true}
                onOpenChange={(open) => setDialog((current) => (current ? { ...current, open } : null))}
            />
            <AddMachineDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                onLinkWithCode={() => {
                    setAddOpen(false);
                    setLinkOpen(true);
                }}
            />
            <LinkMachineDialog nested open={linkOpen} initialCode={null} onOpenChange={setLinkOpen} />
        </>
    );
}

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { Check, Copy, Link2, Server, Trash } from 'lucide-react';
import type { AuthSession } from '@ruimte/contracts';
import { activateEndpoint, listPairedClients, pairEndpoint, requestPairingUrl, revokePairedClient } from '@/endpoint';
import { useEndpoints, LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useServer } from '@/state/server';
import { transport } from '@/transport';
import { Button } from '@/ui/Button';
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

/* A pairing link that names the loopback address can only be a daemon that nobody else can reach. */
const onlyLoopback = (link: string): boolean => {
    try {
        const host = new URL(link).hostname;
        return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
    } catch {
        return false;
    }
};

/* The clients paired with the active daemon, each with a way to cut it off, and for the daemon on this machine a way to invite one. */
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

    // The list belongs to the daemon behind the socket, so it loads again on every reconnect; a switch remounts this whole block.
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
            setFailure(failureText(e, 'Could not make a pairing link'));
        } finally {
            setBusy(false);
        }
    };

    const copyLink = (): void => {
        if (!link) {
            return;
        }
        void navigator.clipboard?.writeText(link).catch(() => undefined);
        setCopied(true);
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Paired clients</span>
                <span className="grow" />
                {reachability === 'loopback' && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void showLink()}>
                        <Icon icon={Link2} size={12} /> Show pairing link
                    </Button>
                )}
            </div>
            {link && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-sunken p-2.5">
                    <div className="flex items-center gap-2">
                        <code className="min-w-0 grow truncate font-mono text-code text-text select-text">{link}</code>
                        <Tooltip label={copied ? 'Copied' : 'Copy pairing link'} name>
                            <button className="icon-btn h-7 w-7 shrink-0" onClick={copyLink}>
                                {copied ? <Icon icon={Check} size={16} /> : <Icon icon={Copy} size={16} />}
                            </button>
                        </Tooltip>
                    </div>
                    <p className="text-xs text-text-faint">
                        {onlyLoopback(link)
                            ? 'This daemon only listens on this machine; start it with --host 0.0.0.0 before another machine can use a link.'
                            : 'Paste it in the settings of Ruimte on the other machine. It works once, within ten minutes.'}
                    </p>
                </div>
            )}
            {sessions !== null && sessions.length === 0 && <p className="text-xs text-text-faint">No other machine is paired with this daemon.</p>}
            {sessions?.map((session) => (
                <div key={session.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                    <div className="flex min-w-0 grow flex-col">
                        <span className="truncate text-xs text-text">
                            {session.label}
                            {session.current && <span className="ml-1.5 text-xs text-accent">this client</span>}
                        </span>
                        <span className="truncate text-xs text-text-faint">
                            paired {new Date(session.createdAt).toLocaleDateString()}, seen {ago(session.lastSeenAt)}
                        </span>
                    </div>
                    <Tooltip label="Revoke access">
                        <button className="icon-btn h-7 w-7 shrink-0" aria-label={`Revoke ${session.label}`} onClick={() => setTarget(session)}>
                            <Icon icon={Trash} size={16} />
                        </button>
                    </Tooltip>
                </div>
            ))}
            {failure && <p className="text-xs text-status-error">{failure}</p>}
            <Dialog.Root open={target !== null} onOpenChange={(open) => (open ? undefined : setTarget(null))}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop" />
                    <Dialog.Popup className="dialog-popup top-[24vh] w-[380px] p-5">
                        <Dialog.Title className="text-base font-semibold text-text">Revoke {target?.label}?</Dialog.Title>
                        <p className="mt-1 text-xs text-text-muted">
                            {target?.current
                                ? 'This is the client you are using. It loses access to this machine and goes back to its own daemon; pair again to return.'
                                : 'That client loses access to this daemon at its next connection. Pairing again needs a fresh link.'}
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
        </div>
    );
}

/* The daemons this client knows, and the way to add one from a pairing link. */
export function EndpointsSection() {
    const endpoints = useEndpoints((s) => s.endpoints);
    const activeId = useEndpoints((s) => s.activeId);
    const mismatched = useEndpoints((s) => s.mismatched);
    const [link, setLink] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const pair = async (): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            const endpoint = await pairEndpoint(link);
            setLink('');
            await activateEndpoint(endpoint.id);
        } catch (e) {
            setFailure(failureText(e, 'Pairing failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-2">
            {/* One daemon is active at a time, so the list is a set of radios; forgetting a machine is
                something else and sits beside the radio, not inside it. */}
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Machines this client talks to">
                {endpoints.map((endpoint) => (
                    <div
                        key={endpoint.id}
                        className={clsx(
                            'flex items-center gap-2 rounded-lg border px-2.5 py-2',
                            endpoint.id === activeId ? 'border-accent bg-accent-soft' : 'border-border'
                        )}
                    >
                        <button
                            role="radio"
                            aria-checked={endpoint.id === activeId}
                            className="flex min-w-0 grow items-start gap-2 text-left"
                            onClick={() => void activateEndpoint(endpoint.id)}
                        >
                            {/* The address under the label makes this row two lines high, so the 20 pixel
                                boxes hold the icon and the trailing state on the label's line. */}
                            <span className="flex h-5 shrink-0 items-center">
                                <Icon icon={Server} size={14} className="text-text-muted" />
                            </span>
                            <span className="flex min-w-0 grow flex-col">
                                <span className="truncate text-sm text-text">{endpoint.label}</span>
                                <span className="truncate font-mono text-xs text-text-faint">
                                    {endpoint.id === LOCAL_ENDPOINT_ID ? 'loopback' : endpoint.httpBaseUrl}
                                </span>
                                {mismatched[endpoint.id] !== undefined && (
                                    <span className="text-xs text-status-error">This address answers as another machine; pair again to talk to it.</span>
                                )}
                            </span>
                            <span className="flex h-5 shrink-0 items-center">
                                {endpoint.id === activeId ? (
                                    <Icon icon={Check} size={14} className="text-accent" />
                                ) : (
                                    <span className="text-xs text-text-muted">Switch</span>
                                )}
                            </span>
                        </button>
                        {endpoint.id !== LOCAL_ENDPOINT_ID && (
                            <Tooltip label="Forget this machine" name>
                                <button className="icon-btn h-7 w-7" onClick={() => useEndpoints.getState().remove(endpoint.id)}>
                                    <Icon icon={Trash} size={16} />
                                </button>
                            </Tooltip>
                        )}
                    </div>
                ))}
            </div>
            <PairedClients key={activeId} />
            <div className="flex items-center gap-2">
                <input
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
                <Button variant="primary" disabled={busy || !link.trim()} onClick={() => void pair()}>
                    <Icon icon={Link2} size={12} /> Pair
                </Button>
            </div>
            <p className="text-xs text-text-faint">Paste the link from "Show pairing link" or from `ruimte pair` on the other machine.</p>
            {failure && <p className="text-xs text-status-error">{failure}</p>}
        </div>
    );
}

/* Theme, font and accent, and the machines the client can talk to. Everything else is a default on purpose. */

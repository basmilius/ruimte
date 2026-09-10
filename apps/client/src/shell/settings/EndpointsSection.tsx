import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { faCheck, faCopy, faLink, faServer, faTrash } from '@fortawesome/duotone-regular-svg-icons';
import type { AuthSession } from '@ruimte/contracts';
import { activateEndpoint, listPairedClients, pairEndpoint, requestPairingUrl, revokePairedClient } from '@/endpoint';
import { useEndpoints, LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useServer } from '@/state/server';
import { transport } from '@/transport';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

const buttonClass = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium disabled:opacity-50';

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
                <span className="text-[12px] text-text-muted">Paired clients</span>
                <span className="grow" />
                {reachability === 'loopback' && (
                    <button
                        className={clsx(buttonClass, 'h-7 border border-border text-text-muted hover:bg-surface-sunken hover:text-text')}
                        disabled={busy}
                        onClick={() => void showLink()}
                    >
                        <Icon icon={faLink} size={12} /> Show pairing link
                    </button>
                )}
            </div>
            {link && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-sunken p-2.5">
                    <div className="flex items-center gap-2">
                        <code className="min-w-0 grow truncate font-mono text-[12px] text-text select-text">{link}</code>
                        <Tooltip label={copied ? 'Copied' : 'Copy link'}>
                            <button className="icon-btn h-6 w-6 shrink-0" aria-label="Copy pairing link" onClick={copyLink}>
                                {copied ? <Icon icon={faCheck} size={12} /> : <Icon icon={faCopy} size={12} />}
                            </button>
                        </Tooltip>
                    </div>
                    <p className="text-[11px] text-text-faint">
                        {onlyLoopback(link)
                            ? 'This daemon only listens on this machine; start it with --host 0.0.0.0 before another machine can use a link.'
                            : 'Paste it in the settings of Ruimte on the other machine. It works once, within ten minutes.'}
                    </p>
                </div>
            )}
            {sessions !== null && sessions.length === 0 && <p className="text-[11px] text-text-faint">No other machine is paired with this daemon.</p>}
            {sessions?.map((session) => (
                <div key={session.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                    <div className="flex min-w-0 grow flex-col">
                        <span className="truncate text-[12px] text-text">
                            {session.label}
                            {session.current && <span className="ml-1.5 text-[11px] text-accent">this client</span>}
                        </span>
                        <span className="truncate text-[11px] text-text-faint">
                            paired {new Date(session.createdAt).toLocaleDateString()}, seen {ago(session.lastSeenAt)}
                        </span>
                    </div>
                    <Tooltip label="Revoke access">
                        <button className="icon-btn h-6 w-6 shrink-0" aria-label={`Revoke ${session.label}`} onClick={() => setTarget(session)}>
                            <Icon icon={faTrash} size={12} />
                        </button>
                    </Tooltip>
                </div>
            ))}
            {failure && <p className="text-[12px] text-status-error">{failure}</p>}
            <Dialog.Root open={target !== null} onOpenChange={(open) => (open ? undefined : setTarget(null))}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop" />
                    <Dialog.Popup className="dialog-popup top-[24vh] w-[380px] p-5">
                        <Dialog.Title className="text-[15px] font-semibold text-text">Revoke {target?.label}?</Dialog.Title>
                        <p className="mt-1 text-[12px] text-text-muted">
                            {target?.current
                                ? 'This is the client you are using. It loses access to this machine and goes back to its own daemon; pair again to return.'
                                : 'That client loses access to this daemon at its next connection. Pairing again needs a fresh link.'}
                        </p>
                        <div className="mt-4 flex items-center justify-end gap-2">
                            <button className={clsx(buttonClass, 'text-text-muted hover:bg-surface-sunken hover:text-text')} onClick={() => setTarget(null)}>
                                Cancel
                            </button>
                            <button className={clsx(buttonClass, 'bg-status-error text-accent-text')} disabled={busy} onClick={() => void revoke()}>
                                <Icon icon={faTrash} size={13} /> Revoke
                            </button>
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
            {endpoints.map((endpoint) => (
                <div
                    key={endpoint.id}
                    className={clsx(
                        'flex items-center gap-2 rounded-lg border px-2.5 py-2',
                        endpoint.id === activeId ? 'border-accent bg-accent-soft' : 'border-border'
                    )}
                >
                    <Icon icon={faServer} size={14} className="shrink-0 text-text-muted" />
                    <button className="flex min-w-0 grow flex-col text-left" onClick={() => void activateEndpoint(endpoint.id)}>
                        <span className="truncate text-[13px] text-text">{endpoint.label}</span>
                        <span className="truncate font-mono text-[11px] text-text-faint">
                            {endpoint.id === LOCAL_ENDPOINT_ID ? 'loopback' : endpoint.httpBaseUrl}
                        </span>
                    </button>
                    {endpoint.id === activeId && <Icon icon={faCheck} size={13} className="shrink-0 text-accent" />}
                    {endpoint.id !== LOCAL_ENDPOINT_ID && (
                        <Tooltip label="Forget this machine">
                            <button className="icon-btn h-6 w-6" aria-label="Forget this machine" onClick={() => useEndpoints.getState().remove(endpoint.id)}>
                                <Icon icon={faTrash} size={12} />
                            </button>
                        </Tooltip>
                    )}
                </div>
            ))}
            <PairedClients key={activeId} />
            <div className="flex items-center gap-2">
                <input
                    className="h-8 min-w-0 grow rounded-lg border border-border bg-surface px-2.5 font-mono text-[12px] text-text outline-none placeholder:text-text-faint focus:border-accent"
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
                <button className={clsx(buttonClass, 'bg-accent text-accent-text')} disabled={busy || !link.trim()} onClick={() => void pair()}>
                    <Icon icon={faLink} size={13} /> Pair
                </button>
            </div>
            <p className="text-[11px] text-text-faint">Paste the link from "Show pairing link" or from `ruimte pair` on the other machine.</p>
            {failure && <p className="text-[12px] text-status-error">{failure}</p>}
        </div>
    );
}

/* Theme, font and accent, and the machines the client can talk to. Everything else is a default on purpose. */

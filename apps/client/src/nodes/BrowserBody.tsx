import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import {
    ArrowLeft,
    ArrowRight,
    Ban,
    CircleAlert,
    Clock,
    Code,
    ExternalLink,
    Globe,
    Link2Off,
    Lock,
    RotateCw,
    ShieldAlert,
    Unplug,
    WifiOff,
    X
} from 'lucide-react';
import { classifyLoadError, type LoadErrorKind } from '@/browser/load-error';
import { prettyUrl } from '@/browser/pretty-url';
import { browserRegistry, useBrowserRow } from '@/browser/registry';
import { endpointKey, useEndpointId } from '@/state/keys';
import { deriveNodeTitle } from '@/chat/title';
import { desktop, isApplePlatform, isDesktop } from '@/desktop/bridge';
import { renameHost, updateHost, useNodeHost } from '@/nodes/node-host';
import { Button } from '@/ui/Button';
import { BTN_GROUP } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import { formatShortcut, KEY_SHORTCUTS } from '@/ui/shortcut';

export const DEFAULT_URL = 'https://bas.dev';

/*
 * Keeps one page alive for this id and writes back the address it ends up on, so the node or the
 * view opens where it was left. The page itself is a <webview> in the parking layer, never here.
 */
export const usePage = (id: string): { url: string; available: boolean } => {
    const host = useNodeHost(id);
    const savedUrl = host?.url;
    const named = host?.titleSource === 'user';
    const title = host?.title;
    const state = useBrowserRow(id, (row) => row);
    const key = endpointKey(useEndpointId(), id);
    const available = isDesktop();

    useEffect(() => {
        if (available) {
            browserRegistry.ensure(key, savedUrl ?? DEFAULT_URL);
        }
        // The page stays when this unmounts (culling, a view switch); only a delete destroys it.
    }, [key, available, savedUrl]);

    useEffect(() => {
        // The last address a page reached is what it opens with next time.
        if (state?.url && state.url !== 'about:blank' && state.url !== savedUrl) {
            updateHost(id, { url: state.url });
        }
    }, [id, state?.url, savedUrl]);

    useEffect(() => {
        // The page names the node, the way a chat names itself from its first prompt: only while
        // nobody has named it, and never again after a person does. A load that failed keeps the
        // name it had, because the title on offer is then Chromium's error page.
        const next = state?.title ? deriveNodeTitle(state.title) : null;
        if (!named && !state?.error && next && next !== title) {
            renameHost(id, next, 'auto');
        }
    }, [id, named, title, state?.title, state?.error]);

    return { url: state?.url ?? savedUrl ?? DEFAULT_URL, available };
};

/* Back, forward, the address and reload: in the node's own bar, or in the toolbar for a browser view. */
export function BrowserToolbar({ id, focused }: { id: string; focused: boolean }) {
    const state = useBrowserRow(id, (row) => row);
    const key = endpointKey(useEndpointId(), id);
    const [draft, setDraft] = useState<string | null>(null);
    // The field reads short until someone puts the keyboard in it, and whole while they edit.
    const [editing, setEditing] = useState(false);
    const field = useRef<HTMLInputElement>(null);
    const saved = useNodeHost(id)?.url;
    const url = draft ?? state?.url ?? saved ?? DEFAULT_URL;
    const secure = url.startsWith('https://');

    // The whole address arrives with the render that follows the focus, so it is selected after it.
    useEffect(() => {
        if (editing) {
            field.current?.select();
        }
    }, [editing]);

    return (
        <>
            <div className={BTN_GROUP}>
                <Tooltip label="Back" name>
                    <button className="icon-btn h-7 w-7 disabled:opacity-40" disabled={!state?.canGoBack} onClick={() => browserRegistry.back(key)}>
                        <Icon icon={ArrowLeft} size={16} />
                    </button>
                </Tooltip>
                <Tooltip label="Forward" name>
                    <button className="icon-btn h-7 w-7 disabled:opacity-40" disabled={!state?.canGoForward} onClick={() => browserRegistry.forward(key)}>
                        <Icon icon={ArrowRight} size={16} />
                    </button>
                </Tooltip>
                {/* While a page is on its way the same square ends it, the way every browser does it. */}
                {state?.loading ? (
                    <Tooltip label="Stop loading" name>
                        <button className="icon-btn h-7 w-7" onClick={() => browserRegistry.stop(key)}>
                            <Icon icon={X} size={16} />
                        </button>
                    </Tooltip>
                ) : (
                    <Tooltip label="Reload" kbd={`${formatShortcut(KEY_SHORTCUTS.shift, isApplePlatform())} skips the cache`} name>
                        <button className="icon-btn h-7 w-7" onClick={(e) => browserRegistry.reload(key, e.shiftKey)}>
                            <Icon icon={RotateCw} size={16} />
                        </button>
                    </Tooltip>
                )}
            </div>
            <div
                className={clsx(
                    'relative mx-[30px] flex h-7 grow items-center gap-2 overflow-hidden rounded-md border border-border-soft bg-surface-sunken px-2.5 text-xs text-text-muted',
                    focused && 'ring-1 ring-border-strong'
                )}
            >
                {secure && <Icon icon={Lock} size={12} className="shrink-0" />}
                <input
                    ref={field}
                    className="grow bg-transparent font-sans text-sm text-text outline-none placeholder:text-text-faint"
                    aria-label="Address"
                    placeholder="Enter an address"
                    value={editing ? url : prettyUrl(url)}
                    spellCheck={false}
                    tabIndex={focused ? 0 : -1}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={() => setEditing(true)}
                    onBlur={() => {
                        setDraft(null);
                        setEditing(false);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            return;
                        }
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                            browserRegistry.navigate(key, url);
                            setDraft(null);
                            e.currentTarget.blur();
                        }
                    }}
                />
                {/* A guest reports a start and a stop and nothing in between, so the line sweeps
                    rather than fills: it says the wait is the page's, not how far along it is. */}
                {state?.loading && <div className="progress-line absolute inset-x-0 bottom-0" role="progressbar" aria-label="Loading the page" />}
            </div>
            <div className={BTN_GROUP}>
                <Tooltip label="Open in the system browser" name>
                    <button className="icon-btn h-7 w-7" onClick={() => void desktop()?.openExternal(state?.url ?? url)}>
                        <Icon icon={ExternalLink} size={16} />
                    </button>
                </Tooltip>
                <Tooltip label="Inspect" name>
                    <button className="icon-btn h-7 w-7" onClick={() => browserRegistry.inspect(key)}>
                        <Icon icon={Code} size={16} />
                    </button>
                </Tooltip>
            </div>
            {/* The bar is the one piece a browser node and a browser view both mount, and the plate
                it draws lands in the parked host either way, never in the bar itself. */}
            <BrowserErrorPlate id={id} />
        </>
    );
}

const ERROR_ICON: Record<LoadErrorKind, LucideIcon> = {
    offline: WifiOff,
    dns: Globe,
    refused: Unplug,
    certificate: ShieldAlert,
    timeout: Clock,
    blocked: Ban,
    address: Link2Off,
    other: CircleAlert
};

/*
 * What a page that did not load says, over the page it replaces. Chromium paints an error page of
 * its own inside the guest, in another product's chrome and with no way back to this app, so the
 * plate covers it. It goes in the parked host rather than in the node's body, because that host is
 * what the layer puts over the node and over a browser view's whole column alike.
 */
function BrowserErrorPlate({ id }: { id: string }) {
    const failure = useBrowserRow(id, (row) => row?.error ?? null);
    const key = endpointKey(useEndpointId(), id);
    // The host is the page's parent, adopted by the layer long before any load can fail.
    const host = failure === null ? null : (browserRegistry.get(key)?.parentElement ?? null);
    if (!failure || !host) {
        return null;
    }
    const error = classifyLoadError(failure.code, failure.description);
    return createPortal(
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg" role="alert">
            <EmptyState
                icon={<Icon icon={ERROR_ICON[error.kind]} size={24} />}
                action={
                    <div className="flex items-center gap-2">
                        {error.retryable && (
                            <Button variant="secondary" size="sm" onClick={() => browserRegistry.reload(key, true)}>
                                Try again
                            </Button>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => void desktop()?.openExternal(failure.url)}>
                            Open in system browser
                        </Button>
                    </div>
                }
            >
                <span className="mb-1 block text-sm text-text">{error.title}</span>
                <span className="block break-all text-text-muted">{prettyUrl(failure.url)}</span>
                {error.hint && <span className="mt-2 block">{error.hint}</span>}
                {/* Chromium's own name for it: the one part of this that is worth searching for. */}
                <span className="mt-2 block font-mono text-text-faint">{error.symbol}</span>
            </EmptyState>
        </div>,
        host
    );
}

/* What a browser shows where the page cannot be: a link out to the system browser. */
export function BrowserFallback({ id, className }: { id: string; className?: string }) {
    const saved = useNodeHost(id)?.url;
    if (!isDesktop()) {
        return (
            <div className={clsx('flex h-full flex-col items-center justify-center gap-2 bg-surface px-6 text-center text-xs text-text-muted', className)}>
                <span>Web pages open only in the desktop app.</span>
                {saved && saved !== DEFAULT_URL && (
                    <a className="inline-flex items-center gap-1 text-accent" href={saved} target="_blank" rel="noreferrer">
                        <Icon icon={ExternalLink} size={12} /> {saved}
                    </a>
                )}
            </div>
        );
    }
    return <div className={clsx('h-full bg-surface-sunken', className)} />;
}

/*
 * The body of a browser node: its own bar over the page. The page lives in the parking layer, so
 * this is the frame around a hole; a browser view puts the same bar in the toolbar instead.
 */
export function BrowserBody({ id, focused }: { id: string; focused: boolean }) {
    const { available } = usePage(id);

    if (!available) {
        return <BrowserFallback id={id} />;
    }
    return (
        <div className="flex h-full flex-col bg-surface">
            <div className="flex h-[37px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-1">
                <BrowserToolbar id={id} focused={focused} />
            </div>
            <BrowserFallback id={id} className="grow" />
        </div>
    );
}

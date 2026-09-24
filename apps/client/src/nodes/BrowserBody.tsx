import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
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
import { BrowserSplash } from '@/browser/BrowserSplash';
import { classifyLoadError, type LoadErrorKind } from '@/browser/load-error';
import { drivePage, openPage } from '@/browser/open-page';
import { prettyUrl } from '@/browser/pretty-url';
import { browserRegistry, useBrowserRow } from '@/browser/registry';
import { BrowserStream } from '@/browser/BrowserStream';
import { browserStreamScaleLimit, browserStreamScaleOptions, clampBrowserStreamScale, useBrowserStreamQuality } from '@/browser/stream-quality';
import { useSwipeOverlay } from '@/browser/swipe-overlay';
import { endpointKey, useEndpointId } from '@/state/keys';
import { desktop, isApplePlatform, isDesktop } from '@/desktop/bridge';
import { useNodeHost } from '@/nodes/node-host';
import { usePage } from '@/nodes/use-page';
import { Button } from '@/ui/Button';
import { BTN_GROUP } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import { Select } from '@/ui/Select';
import { formatShortcut, KEY_SHORTCUTS } from '@/ui/shortcut';

/* Back, forward, the address and reload: in the node's own bar, or in the toolbar for a browser view. */
export function BrowserToolbar({ id, focused }: { id: string; focused: boolean }) {
    const { t } = useTranslation('canvas');
    const state = useBrowserRow(id, (row) => row);
    const preferredScale = useBrowserStreamQuality((store) => store.scale);
    const setScale = useBrowserStreamQuality((store) => store.setScale);
    const endpointId = useEndpointId();
    const key = endpointKey(endpointId, id);
    const native = isDesktop();
    const command = (action: 'back' | 'forward' | 'reload' | 'stop', ignoreCache?: boolean): void => drivePage(id, action, ignoreCache);
    const [draft, setDraft] = useState<string | null>(null);
    // The field reads short until someone puts the keyboard in it, and whole while they edit.
    const [editing, setEditing] = useState(false);
    const field = useRef<HTMLInputElement>(null);
    const saved = useNodeHost(id)?.url;
    const url = draft ?? state?.url ?? saved ?? '';
    // A node showing its splash has no page behind the bar, so nothing there is worth pressing.
    const hasPage = (state?.url ?? saved ?? '') !== '';
    const secure = url.startsWith('https://');
    const scaleLimit = browserStreamScaleLimit();
    const scale = clampBrowserStreamScale(preferredScale, scaleLimit);
    const scaleItems = browserStreamScaleOptions(scaleLimit).map((value) => ({ value: String(value), label: `${value}×` }));

    // The whole address arrives with the render that follows the focus, so it is selected after it.
    useEffect(() => {
        if (editing) {
            field.current?.select();
        }
    }, [editing]);

    return (
        <>
            <div className={BTN_GROUP}>
                <Tooltip label={t('browser.back')} name>
                    <button className="icon-btn icon-btn-sm" disabled={!state?.canGoBack} onClick={() => command('back')}>
                        <Icon icon={ArrowLeft} size={14} />
                    </button>
                </Tooltip>
                <Tooltip label={t('browser.forward')} name>
                    <button className="icon-btn icon-btn-sm" disabled={!state?.canGoForward} onClick={() => command('forward')}>
                        <Icon icon={ArrowRight} size={14} />
                    </button>
                </Tooltip>
                {/* While a page is on its way the same square ends it, the way every browser does it. */}
                {state?.loading ? (
                    <Tooltip label={t('browser.stop')} name>
                        <button className="icon-btn icon-btn-sm" onClick={() => command('stop')}>
                            <Icon icon={X} size={14} />
                        </button>
                    </Tooltip>
                ) : (
                    <Tooltip
                        label={t('common:action.reload')}
                        kbd={t('browser.reloadHint', { shortcut: formatShortcut(KEY_SHORTCUTS.shift, isApplePlatform()) })}
                        name
                    >
                        <button className="icon-btn icon-btn-sm" disabled={!hasPage} onClick={(e) => command('reload', e.shiftKey)}>
                            <Icon icon={RotateCw} size={14} />
                        </button>
                    </Tooltip>
                )}
            </div>
            <div
                className={clsx(
                    'app-no-drag relative mx-[30px] flex h-7 grow items-center gap-2 overflow-hidden rounded-md border border-border-soft bg-surface-sunken px-2.5 text-xs text-text-muted',
                    focused && 'ring-1 ring-border-strong'
                )}
            >
                {secure && <Icon icon={Lock} size={12} className="shrink-0" />}
                <input
                    ref={field}
                    className="grow bg-transparent font-sans text-sm text-text outline-none placeholder:text-text-faint"
                    aria-label={t('browser.address')}
                    placeholder={t('browser.addressPlaceholder')}
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
                        if (e.key === 'Enter' && url.trim() !== '') {
                            openPage(id, url);
                            setDraft(null);
                            e.currentTarget.blur();
                        }
                    }}
                />
                {/* A guest reports a start and a stop and nothing in between, so the line sweeps
                    rather than fills: it says the wait is the page's, not how far along it is. */}
                {state?.loading && <div className="progress-line absolute inset-x-0 bottom-0" role="progressbar" aria-label={t('browser.loading')} />}
            </div>
            <div className={BTN_GROUP}>
                {!native && (
                    <Select<string>
                        value={String(scale)}
                        onValueChange={(value) => setScale(Number(value))}
                        items={scaleItems}
                        label={t('browser.streamDpi')}
                        size="sm"
                        variant="ghost"
                        align="end"
                        truncateValue={false}
                        className="w-[76px] justify-center tabular-nums"
                    />
                )}
                <Tooltip label={t('browser.openExternal')} name>
                    <button
                        className="icon-btn icon-btn-sm"
                        disabled={!hasPage}
                        onClick={() => {
                            const target = state?.url ?? url;
                            if (native) {
                                void desktop()?.openExternal(target);
                            } else {
                                window.open(target, '_blank', 'noopener,noreferrer');
                            }
                        }}
                    >
                        <Icon icon={ExternalLink} size={14} />
                    </button>
                </Tooltip>
                {native && (
                    <Tooltip label={t('browser.inspect')} name>
                        <button className="icon-btn icon-btn-sm" disabled={!hasPage} onClick={() => browserRegistry.inspect(key)}>
                            <Icon icon={Code} size={14} />
                        </button>
                    </Tooltip>
                )}
            </div>
            {/* The bar is the one piece a browser node and a browser view both mount, and the plate
                it draws lands in the parked host either way, never in the bar itself. */}
            <BrowserErrorPlate id={id} />
            <SwipeArrow id={id} />
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
    const { t } = useTranslation('canvas');
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
                icon={ERROR_ICON[error.kind]}
                title={error.title}
                action={
                    <div className="flex items-center gap-2">
                        {error.retryable && (
                            <Button variant="secondary" size="sm" onClick={() => drivePage(id, 'reload', true)}>
                                {t('common:action.retry')}
                            </Button>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => void desktop()?.openExternal(failure.url)}>
                            {t('browser.error.openExternal')}
                        </Button>
                    </div>
                }
            >
                <span className="block break-all text-text-muted">{prettyUrl(failure.url)}</span>
                {error.hint && <span className="mt-2 block">{error.hint}</span>}
                {/* Chromium's own name for it: the one part of this that is worth searching for. */}
                <span className="mt-2 block font-mono text-text-faint">{error.symbol}</span>
            </EmptyState>
        </div>,
        host
    );
}

/* The shield a swipe slides in from the edge: a circle of this size, at most half of it inside the page. */
const SWIPE_ARROW_PX = 140;

/*
 * The arrow of a swipe, at the edge of the page it goes towards, in the parked host for the same
 * reason the error plate is. It follows the fingers and has no motion of its own until it goes: then
 * it fades, which the reduced motion rule in `styles.css` turns into leaving at once.
 */
function SwipeArrow({ id }: { id: string }) {
    const key = endpointKey(useEndpointId(), id);
    const arrow = useSwipeOverlay((s) => s.byKey[key] ?? null);
    const host = arrow === null ? null : (browserRegistry.get(key)?.parentElement ?? null);
    if (!arrow || !host) {
        return null;
    }
    const back = arrow.side === 'back';
    const reached = arrow.progress >= 1;
    const inset = Math.round((SWIPE_ARROW_PX / 2) * arrow.progress) - SWIPE_ARROW_PX;
    const opacity = !arrow.shown ? 0 : reached ? 0.75 : 0.25 + 0.4 * arrow.progress;
    return createPortal(
        <div
            aria-hidden
            className={clsx(
                'pointer-events-none absolute top-1/2 z-10 flex -translate-y-1/2 items-center rounded-full border border-border bg-surface-raised',
                back ? 'justify-end pr-5' : 'justify-start pl-5',
                reached ? 'text-text' : 'text-text-muted',
                !arrow.shown && 'transition-opacity duration-[400ms]'
            )}
            style={{ width: SWIPE_ARROW_PX, height: SWIPE_ARROW_PX, opacity, ...(back ? { left: inset } : { right: inset }) }}
        >
            <Icon icon={back ? ArrowLeft : ArrowRight} size={24} />
        </div>,
        host
    );
}

/* What a browser draws under its own page: the splash while it has no address, a streamed copy where
   there is no native <webview>, or an empty placeholder where the desktop app's <webview> lands. */
export function BrowserFallback({ id, className }: { id: string; className?: string }) {
    const saved = useNodeHost(id)?.url ?? '';
    if (saved === '') {
        return <BrowserSplash id={id} className={className} />;
    }
    if (!isDesktop()) {
        return <BrowserStream id={id} initialUrl={saved} className={className} />;
    }
    return <div className={clsx('h-full bg-surface-sunken', className)} />;
}

/*
 * The body of a browser node: its own bar over the page. The page lives in the parking layer, so
 * this is the frame around a hole; a browser view puts the same bar in the toolbar instead.
 */
export function BrowserBody({ id, focused }: { id: string; focused: boolean }) {
    usePage(id);
    return (
        <div className="flex h-full flex-col bg-surface">
            <div className="flex h-[37px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-1">
                <BrowserToolbar id={id} focused={focused} />
            </div>
            <BrowserFallback id={id} className="grow" />
        </div>
    );
}

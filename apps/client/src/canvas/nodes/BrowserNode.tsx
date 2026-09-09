import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertCircle, ArrowLeft, ArrowRight, Code2, ExternalLink, Loader2, Lock, RotateCw } from 'lucide-react';
import { browserRegistry, useBrowser } from '@/browser/registry';
import { desktop, isDesktop } from '@/desktop/bridge';
import { useCanvas } from '@/state/canvas';
import { Tooltip } from '@/ui/Tooltip';

// A fresh node opens empty with the address bar ready; a page that does not exist yet would only show an error.
const DEFAULT_URL = 'about:blank';

/*
 * The toolbar of a browser node. The page itself lives in the webview layer over the canvas,
 * so it survives a project switch; this component only drives it.
 */
export function BrowserNode({ id, focused }: { id: string; focused: boolean }) {
    const savedUrl = useCanvas((s) => s.nodes[id]?.url);
    const state = useBrowser((s) => s.byNodeId[id]);
    const [draft, setDraft] = useState<string | null>(null);
    const available = isDesktop();

    useEffect(() => {
        if (available) {
            browserRegistry.ensure(id, savedUrl ?? DEFAULT_URL);
        }
        // The page stays when this unmounts (culling, project switch); only a delete destroys it.
    }, [id, available, savedUrl]);

    useEffect(() => {
        // The last address a page reached is what the node opens with next time.
        if (state?.url && state.url !== 'about:blank' && state.url !== savedUrl) {
            useCanvas.getState().updateNode(id, { url: state.url });
        }
    }, [id, state?.url, savedUrl]);

    const url = draft ?? state?.url ?? savedUrl ?? DEFAULT_URL;
    const secure = url.startsWith('https://');

    if (!available) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface px-6 text-center text-[12px] text-text-muted">
                <span>Web pages open inside the desktop app. In a browser tab this node can only hand the address to a new tab.</span>
                {savedUrl && savedUrl !== DEFAULT_URL && (
                    <a className="inline-flex items-center gap-1 text-accent" href={savedUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={12} /> {savedUrl}
                    </a>
                )}
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-surface">
            <div className="flex h-[37px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-1">
                <div className="btn-group">
                    <Tooltip label="Back">
                        <button className="icon-btn h-7 w-7 disabled:opacity-40" disabled={!state?.canGoBack} onClick={() => browserRegistry.back(id)}>
                            <ArrowLeft size={14} />
                        </button>
                    </Tooltip>
                    <Tooltip label="Forward">
                        <button className="icon-btn h-7 w-7 disabled:opacity-40" disabled={!state?.canGoForward} onClick={() => browserRegistry.forward(id)}>
                            <ArrowRight size={14} />
                        </button>
                    </Tooltip>
                    <Tooltip label="Reload" kbd="⇧ skips the cache">
                        <button className="icon-btn h-7 w-7" onClick={(e) => browserRegistry.reload(id, e.shiftKey)}>
                            {state?.loading ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
                        </button>
                    </Tooltip>
                </div>
                <div
                    className={clsx(
                        'flex h-7 grow items-center gap-2 rounded-md bg-surface-sunken px-2.5 text-[12px] text-text-muted',
                        focused && 'ring-1 ring-border-strong'
                    )}
                >
                    {secure && <Lock size={11} className="shrink-0" />}
                    <input
                        className="grow bg-transparent font-mono text-[12px] text-text outline-none placeholder:text-text-faint"
                        placeholder="Enter an address"
                        value={url === 'about:blank' && draft === null ? '' : url}
                        spellCheck={false}
                        tabIndex={focused ? 0 : -1}
                        onChange={(e) => setDraft(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={() => setDraft(null)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                return;
                            }
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                                browserRegistry.navigate(id, url);
                                setDraft(null);
                                e.currentTarget.blur();
                            }
                        }}
                    />
                </div>
                <div className="btn-group">
                    <Tooltip label="Open in the system browser">
                        <button className="icon-btn h-7 w-7" onClick={() => void desktop()?.openExternal(state?.url ?? url)}>
                            <ExternalLink size={13} />
                        </button>
                    </Tooltip>
                    <Tooltip label="Inspect">
                        <button className="icon-btn h-7 w-7" onClick={() => browserRegistry.inspect(id)}>
                            <Code2 size={13} />
                        </button>
                    </Tooltip>
                </div>
            </div>
            <div className="relative grow bg-surface-sunken">
                {state?.error && (
                    <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-border bg-surface-raised/95 px-3 py-2 text-[12px] text-status-error">
                        <AlertCircle size={13} className="shrink-0" />
                        <span className="grow select-text">The page did not load: {state.error}</span>
                        <button className="icon-btn h-6 w-6" onClick={() => browserRegistry.reload(id, true)}>
                            <RotateCw size={12} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

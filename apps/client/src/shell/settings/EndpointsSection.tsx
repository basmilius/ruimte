import { useState } from 'react';
import clsx from 'clsx';
import { Check, Link2, Server, Trash2 } from 'lucide-react';
import { activateEndpoint, pairEndpoint } from '@/endpoint';
import { useEndpoints, LOCAL_ENDPOINT_ID } from '@/state/endpoints';

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
            setFailure(e instanceof Error ? e.message : 'Pairing failed');
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
                    <Server size={14} className="shrink-0 text-text-muted" />
                    <button className="flex min-w-0 grow flex-col text-left" onClick={() => void activateEndpoint(endpoint.id)}>
                        <span className="truncate text-[13px] text-text">{endpoint.label}</span>
                        <span className="truncate font-mono text-[11px] text-text-faint">
                            {endpoint.id === LOCAL_ENDPOINT_ID ? 'loopback' : endpoint.httpBaseUrl}
                        </span>
                    </button>
                    {endpoint.id === activeId && <Check size={13} className="shrink-0 text-accent" />}
                    {endpoint.id !== LOCAL_ENDPOINT_ID && (
                        <button className="icon-btn h-6 w-6" aria-label="Forget this machine" onClick={() => useEndpoints.getState().remove(endpoint.id)}>
                            <Trash2 size={12} />
                        </button>
                    )}
                </div>
            ))}
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
                <button
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-medium text-accent-text disabled:opacity-50"
                    disabled={busy || !link.trim()}
                    onClick={() => void pair()}
                >
                    <Link2 size={13} /> Pair
                </button>
            </div>
            <p className="text-[11px] text-text-faint">Run `bun src/main.ts pair` next to a daemon on another machine and paste the link it prints.</p>
            {failure && <p className="text-[12px] text-status-error">{failure}</p>}
        </div>
    );
}

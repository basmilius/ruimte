import { useState } from 'react';
import { ArrowLeft, ArrowRight, Lock, RotateCw } from 'lucide-react';

/* Placeholder for the webview. The toolbar is real, the page is a sketch. */
export function BrowserNode({ focused }: { id: string; focused: boolean }) {
    const [url, setUrl] = useState('https://ruimte.app');
    return (
        <div className="flex h-full flex-col bg-surface">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-surface-raised px-2">
                <button className="icon-btn h-7 w-7" title="Back"><ArrowLeft size={14} /></button>
                <button className="icon-btn h-7 w-7" title="Forward"><ArrowRight size={14} /></button>
                <button className="icon-btn h-7 w-7" title="Reload"><RotateCw size={13} /></button>
                <div className="ml-1 flex h-7 grow items-center gap-2 rounded-md bg-surface-sunken px-2.5 text-[12px] text-text-muted">
                    <Lock size={11} />
                    <input
                        className="grow bg-transparent text-text outline-none"
                        value={url}
                        tabIndex={focused ? 0 : -1}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
                    />
                </div>
            </div>
            <div className="grow overflow-auto bg-white p-10 text-[#1a1a1a] dark:bg-[#0b0b0d] dark:text-[#e8e8ec]">
                <div className="mx-auto max-w-xl">
                    <div className="mb-8 flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-[#4f46e5]" />
                        <span className="text-lg font-semibold tracking-tight">Ruimte</span>
                    </div>
                    <h1 className="mb-4 text-4xl font-semibold leading-tight tracking-tight">Your terminals, agents and browsers on one canvas.</h1>
                    <p className="mb-8 max-w-md text-[15px] leading-relaxed opacity-70">Sessions survive restarts. Focus stays where you put it. The camera moves only when you move it.</p>
                    <div className="flex gap-3">
                        <div className="rounded-lg bg-[#4f46e5] px-4 py-2 text-[13px] font-medium text-white">Download</div>
                        <div className="rounded-lg border border-black/10 px-4 py-2 text-[13px] font-medium dark:border-white/15">Read the docs</div>
                    </div>
                    <div className="mt-12 grid grid-cols-3 gap-3">
                        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-20 rounded-lg bg-black/5 dark:bg-white/5" />)}
                    </div>
                </div>
            </div>
        </div>
    );
}

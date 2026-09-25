'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Lock, RotateCw } from 'lucide-react';
import { IconButton } from './primitives.tsx';

/** `TerminalBody.tsx` with the xterm theme: 8px in from the left, 13px mono on the terminal ground. */
export function TerminalBody({ children }: { readonly children: ReactNode }) {
    return (
        <div className="absolute inset-0 overflow-hidden bg-term-bg pt-1.5 pl-2 font-mono text-[13px] leading-4 whitespace-pre text-term-fg">{children}</div>
    );
}

/** The address bar of a browser node over its page (`BrowserBody.tsx`). */
export function BrowserBody({ url, loading = false, children }: { readonly url: string; readonly loading?: boolean; readonly children: ReactNode }) {
    return (
        <div className="absolute inset-0 flex flex-col">
            <div className="relative flex h-[37px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-1">
                <IconButton icon={ArrowLeft} size="sm" />
                <IconButton icon={ArrowRight} size="sm" />
                <IconButton icon={RotateCw} size="sm" />
                <span className="flex h-7 min-w-0 grow items-center gap-2 overflow-hidden rounded-md border border-border-soft bg-surface-sunken px-2.5 text-[13px] text-text-muted">
                    <Lock size={12} strokeWidth={1.75} className="shrink-0" />
                    <span className="truncate text-[14px] text-text">{url}</span>
                </span>
                <IconButton icon={ExternalLink} size="sm" />
                {loading && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[rgb(21_93_252/0.16)]">
                        <span className="progress-sweep block h-full w-1/3 bg-accent" />
                    </span>
                )}
            </div>
            <div className="relative min-h-0 grow overflow-hidden bg-surface">{children}</div>
        </div>
    );
}

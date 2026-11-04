'use client';

import { CircleX, GitBranch, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

const ITEM = 'flex h-5 items-center gap-1 rounded-sm px-1';

export interface CodeLine {
    readonly code: ReactNode;
}

/*
 * A file in the editor: the gutter with line numbers, the code in the code font, and `EditorStatusBar.tsx`
 * under it with the branch, the problems, the symbol, the caret and the file's facts.
 */
export function CodeView({ lines, symbol, caret }: { readonly lines: readonly CodeLine[]; readonly symbol: string; readonly caret: string }) {
    return (
        <div className="absolute inset-0 flex flex-col bg-surface">
            <div className="min-h-0 grow overflow-hidden pt-2 font-mono text-[13px] leading-5">
                {lines.map((line, index) => (
                    <div key={index} className="flex">
                        <span className="w-12 shrink-0 pr-5 text-right text-text-faint tabular-nums select-none">{index + 1}</span>
                        <span className="whitespace-pre text-text">{line.code}</span>
                    </div>
                ))}
            </div>
            <div className="relative flex h-[26px] shrink-0 items-center gap-1.5 border-t border-border bg-surface px-2 text-xs whitespace-nowrap text-text-muted">
                <span className={ITEM}>
                    <GitBranch size={12} strokeWidth={1.75} />
                    saved-carts
                </span>
                <span className={ITEM}>
                    <CircleX size={12} strokeWidth={1.75} className="text-text-faint" />0
                    <TriangleAlert size={12} strokeWidth={1.75} className="text-text-faint" />0
                </span>
                <span className={ITEM}>{symbol}</span>
                <span className="grow" />
                <span className={ITEM}>{caret}</span>
                <span className={ITEM}>Spaces: 4</span>
                <span className={ITEM}>UTF-8</span>
                <span className={ITEM}>LF</span>
                <span className={ITEM}>TypeScript</span>
            </div>
        </div>
    );
}

/* Token colors for the few lines a scene shows, in the terminal palette the site already carries. */
export function K({ children }: { readonly children: ReactNode }) {
    return <span className="text-ansi-magenta">{children}</span>;
}

export function F({ children }: { readonly children: ReactNode }) {
    return <span className="text-ansi-blue">{children}</span>;
}

export function S({ children }: { readonly children: ReactNode }) {
    return <span className="text-ansi-green">{children}</span>;
}

export function C({ children }: { readonly children: ReactNode }) {
    return <span className="text-text-faint">{children}</span>;
}

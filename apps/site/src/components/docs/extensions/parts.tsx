'use client';

import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { EASE } from '../../film/playback.ts';

/* A place an extension adds to: dashed while another one has the turn, lit with its name while it has it. */
export function SlotSpot({
    name,
    lit,
    labelBelow = false,
    labelEnd = false,
    className = '',
    children
}: {
    readonly name: string;
    readonly lit: boolean;
    readonly labelBelow?: boolean;

    /* Ends the label at the spot's right edge, for a spot against the right of what clips it. */
    readonly labelEnd?: boolean;
    readonly className?: string;
    readonly children: ReactNode;
}) {
    return (
        <span className={`relative z-20 flex shrink-0 ${className}`}>
            {children}
            <motion.span
                className="pointer-events-none absolute -inset-1 rounded-lg border-2 border-dashed"
                initial={false}
                animate={{
                    borderColor: lit ? 'var(--accent)' : 'rgb(var(--accent-rgb) / 0.35)',
                    boxShadow: lit ? '0 0 0 4px rgb(var(--accent-rgb) / 0.18)' : '0 0 0 0 rgb(var(--accent-rgb) / 0)'
                }}
                transition={{ duration: 0.35, ease: EASE }}
            />
            <motion.span
                className={`absolute ${labelEnd ? 'right-0' : 'left-0'} rounded-[5px] bg-accent px-1.5 font-mono text-[12px] leading-[18px] whitespace-nowrap text-white shadow-float ${labelBelow ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'}`}
                initial={false}
                animate={{ opacity: lit ? 1 : 0, y: lit ? 0 : labelBelow ? -4 : 4 }}
                transition={{ duration: 0.3, ease: EASE }}
            >
                {name}
            </motion.span>
        </span>
    );
}

/* `SelectionBar` in `extensions/SlotSurfaces.tsx`: over the canvas while something an extension acts on is selected. */
export function SelectionBar({ children }: { readonly children: ReactNode }) {
    return (
        <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-lg">
            {children}
        </div>
    );
}

/* A scene that shows less than the whole app, on a window's ground. */
export function SceneFrame({ children }: { readonly children: ReactNode }) {
    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-surface shadow-[0_24px_60px_rgb(0_0_0/0.45)]">
            {children}
        </div>
    );
}

/* A note's body, the brief most scenes start from. */
export function NoteText({ children }: { readonly children: ReactNode }) {
    return <div className="px-3 py-2.5 text-[14px] leading-[21px]">{children}</div>;
}

'use client';

import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'motion/react';
import { EASE } from '../../film/playback.ts';

/* A spot an extension adds to: dashed while another one has the turn, lit with its name while it has it. */
export function SlotSpot({
    name,
    lit,
    x,
    y,
    width,
    height,
    labelBelow = false,
    children
}: {
    readonly name: string;
    readonly lit: boolean;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly labelBelow?: boolean;
    readonly children?: ReactNode;
}) {
    return (
        <div className="absolute z-20" style={{ left: x, top: y, width, height }}>
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
                className={`absolute left-0 rounded-[5px] bg-accent px-1.5 font-mono text-[12px] leading-[18px] whitespace-nowrap text-white shadow-float ${labelBelow ? '-bottom-6' : '-top-6'}`}
                initial={false}
                animate={{ opacity: lit ? 1 : 0, y: lit ? 0 : labelBelow ? -4 : 4 }}
                transition={{ duration: 0.3, ease: EASE }}
            >
                {name}
            </motion.span>
        </div>
    );
}

/* The spinner Ruimte draws on a node while an action of an extension is about it. */
export function Spinner({ className = '', style }: { readonly className?: string; readonly style?: CSSProperties }) {
    return <span className={`docs-spinner inline-block size-3.5 rounded-full border-2 border-accent/25 border-t-accent ${className}`} style={style} />;
}

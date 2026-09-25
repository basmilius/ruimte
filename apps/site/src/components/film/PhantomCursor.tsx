'use client';

import { AnimatePresence, motion } from 'motion/react';
import { PHANTOM_ARROW, PHANTOM_COLORS, PHANTOM_DOT, PHANTOM_SMALL } from './phantom.ts';

export type PhantomMode = 'move' | 'click' | 'think' | 'paused';

// `OverlayStyle.Motion.move`: no overshoot, a pointer that springs past its target reads as a slip.
const MOVE = { duration: 0.7, ease: [0.4, 0, 0.2, 1] } as const;
const MORPH = { duration: 0.46, ease: [0.34, 1.56, 0.64, 1] } as const;

/**
 * The agent's own cursor from computer use: the accent arrow with its white rim, a drop with three
 * dots while it thinks, and a small muted drop while paused. `label` is the pill beside it.
 */
export function PhantomCursor({
    x,
    y,
    mode,
    label,
    typed
}: {
    readonly x: number;
    readonly y: number;
    readonly mode: PhantomMode;
    readonly label?: string;
    readonly typed?: boolean;
}) {
    const color = mode === 'paused' ? PHANTOM_COLORS.muted : PHANTOM_COLORS.accent;
    const path = mode === 'think' ? PHANTOM_DOT : mode === 'paused' ? PHANTOM_SMALL : PHANTOM_ARROW;

    return (
        <motion.div className="pointer-events-none absolute top-0 left-0 z-30" initial={false} animate={{ x: x - 4, y: y - 3.5 }} transition={MOVE}>
            {mode === 'click' && (
                <motion.span
                    key={`${x}-${y}`}
                    className="absolute rounded-full border-2"
                    style={{ left: 4 - 18, top: 3.5 - 18, width: 36, height: 36, borderColor: color }}
                    initial={{ scale: 0.3, opacity: 0.9 }}
                    animate={{ scale: 1, opacity: 0 }}
                    transition={{ duration: 0.55, delay: 0.65, ease: 'easeOut' }}
                />
            )}
            <motion.svg
                width={24}
                height={24}
                viewBox="0 0 24 24"
                className="overflow-visible"
                style={{ filter: 'drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.3))' }}
                animate={mode === 'click' ? { scale: [1, 1, 0.8, 1.08, 1] } : { scale: 1 }}
                transition={mode === 'click' ? { duration: 0.35, delay: 0.62, times: [0, 0.01, 0.35, 0.75, 1] } : { duration: 0.2 }}
            >
                <motion.path
                    d={path}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={7}
                    strokeLinejoin="round"
                    initial={false}
                    animate={{ d: path }}
                    transition={MORPH}
                />
                <motion.path
                    d={path}
                    fill={color}
                    stroke={color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    initial={false}
                    animate={{ d: path, fill: color, stroke: color }}
                    transition={MORPH}
                />
                {mode === 'think' &&
                    [9.3, 12.5, 15.7].map((cx, i) => (
                        <motion.g key={cx} animate={{ y: [0, -1.2, 0] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}>
                            <circle cx={cx} cy={12.5} r={1.1} fill="#ffffff" />
                        </motion.g>
                    ))}
                {mode === 'paused' && (
                    <>
                        <rect x={8.6} y={8.5} width={1.6} height={4} rx={0.5} fill="#ffffff" />
                        <rect x={11.2} y={8.5} width={1.6} height={4} rx={0.5} fill="#ffffff" />
                    </>
                )}
            </motion.svg>
            <AnimatePresence>
                {label && (
                    <motion.div
                        key={label}
                        className="absolute flex h-[26px] items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#18181c] px-[9px] text-[14px] whitespace-nowrap text-[#ececf1] shadow-float"
                        style={{ left: 4 + 18, top: 3.5 + 20 }}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.12, ease: 'easeOut' }}
                    >
                        {typed ? <span className="font-mono text-[13px]">{label}</span> : label}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

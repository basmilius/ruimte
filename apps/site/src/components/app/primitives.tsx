'use client';

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { EASE, usePlayback } from '../film/playback.ts';

/** `.icon-btn` and its sizes from the client's `styles.css`. */
export function IconButton({
    icon: Icon,
    size = 'md',
    active = false,
    className = ''
}: {
    readonly icon: LucideIcon;
    readonly size?: 'md' | 'sm' | 'xs';
    readonly active?: boolean;
    readonly className?: string;
}) {
    const box = size === 'md' ? 'size-8 rounded-lg' : size === 'sm' ? 'size-7 rounded-md' : 'size-6 rounded-md';
    return (
        <span className={`inline-flex shrink-0 items-center justify-center text-text-muted ${box} ${active ? 'bg-surface-active text-text' : ''} ${className}`}>
            <Icon size={size === 'md' ? 16 : size === 'sm' ? 14 : 12} strokeWidth={1.75} />
        </span>
    );
}

export function Separator() {
    return <span className="h-4 w-px shrink-0 bg-border" />;
}

/** `ui/Button.tsx`: ghost by default, inverse for the one action a card asks for. */
export function Button({
    variant = 'ghost',
    size = 'sm',
    className = '',
    children
}: {
    readonly variant?: 'ghost' | 'secondary' | 'primary' | 'inverse';
    readonly size?: 'xs' | 'sm' | 'md';
    readonly className?: string;
    readonly children: ReactNode;
}) {
    const sizes = { xs: 'h-6 px-2', sm: 'h-7 px-2.5', md: 'h-8 px-3' }[size];
    const variants = {
        ghost: 'text-text-muted',
        secondary: 'border border-border bg-surface-raised text-text',
        primary: 'bg-accent text-white',
        inverse: 'bg-text text-bg'
    }[variant];
    return (
        <span
            className={`relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-[13px] leading-[19px] font-medium ${sizes} ${variants} ${className}`}
        >
            {children}
        </span>
    );
}

export function TrafficLights({ className = '' }: { readonly className?: string }) {
    return (
        <span className={`flex gap-2 ${className}`}>
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
        </span>
    );
}

/** A project's letter on a tint of its color, as the project menu draws it. */
export function ProjectGlyph({ letter, color, size = 16 }: { readonly letter: string; readonly color: string; readonly size?: number }) {
    return (
        <span
            className="inline-flex shrink-0 items-center justify-center rounded-sm font-semibold"
            style={{ width: size, height: size, fontSize: Math.max(12, size * 0.68), color, background: `color-mix(in srgb, ${color} 20%, transparent)` }}
        >
            {letter}
        </span>
    );
}

/**
 * Text that types itself once `shown`, a character at a time. Hidden again, it starts over.
 */
export function Typed({ shown, ...props }: TypedProps & { readonly shown: boolean }) {
    return shown ? <TypedText {...props} /> : null;
}

interface TypedProps {
    readonly text: string;
    /** Milliseconds per character. */
    readonly speed?: number;
    /** Types whole words at a time, the way a chat streams. */
    readonly words?: boolean;
    readonly caret?: boolean;
    readonly className?: string;
    readonly style?: CSSProperties;
}

function TypedText({ text, speed = 28, words = false, caret = false, className = '', style }: TypedProps) {
    const { playing, still } = usePlayback();
    const [count, setCount] = useState(0);
    const done = still || count >= text.length;

    useEffect(() => {
        if (!playing || done) {
            return;
        }
        const next = words ? text.indexOf(' ', count + 1) : count + 1;
        const timer = window.setTimeout(() => setCount(next === -1 ? text.length : next), words ? speed * 4 : speed);
        return () => window.clearTimeout(timer);
    }, [playing, done, count, speed, text, words]);

    return (
        <span className={className} style={style}>
            {still ? text : text.slice(0, count)}
            {caret && !done && <span className="caret ml-px inline-block h-[1em] w-[0.5em] translate-y-[0.15em] bg-current" />}
        </span>
    );
}

export function Reveal({
    shown,
    delay = 0,
    y = 6,
    className = '',
    style,
    children
}: {
    readonly shown: boolean;
    readonly delay?: number;
    readonly y?: number;
    readonly className?: string;
    readonly style?: CSSProperties;
    readonly children: ReactNode;
}) {
    // Out of the layout while hidden, so a line still to come leaves no gap in a thread.
    return (
        <AnimatePresence initial={false}>
            {shown && (
                <motion.div
                    className={className}
                    style={style}
                    initial={{ opacity: 0, y }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.35, ease: EASE, delay }}
                >
                    {children}
                </motion.div>
            )}
        </AnimatePresence>
    );
}

/** The person's own pointer, next to the agent's phantom one. */
export function PersonCursor({ x, y, click = false }: { readonly x: number; readonly y: number; readonly click?: boolean }) {
    return (
        <motion.div
            className="pointer-events-none absolute top-0 left-0 z-40"
            initial={false}
            animate={{ x, y }}
            transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
        >
            {click && (
                <motion.span
                    key={`${x}-${y}`}
                    className="absolute -top-3 -left-3 size-6 rounded-full bg-white/40"
                    initial={{ scale: 0.3, opacity: 0 }}
                    animate={{ scale: [0.3, 1.4], opacity: [0.8, 0] }}
                    transition={{ duration: 0.45, delay: 0.8 }}
                />
            )}
            <svg width="20" height="24" viewBox="0 0 20 24" style={{ filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.5))' }}>
                <path
                    d="M1.5 1.5 L1.5 19 L6 14.8 L9.2 22 L12.3 20.6 L9.2 13.6 L15.4 13.6 Z"
                    fill="#000000"
                    stroke="#ffffff"
                    strokeWidth={1.4}
                    strokeLinejoin="round"
                />
            </svg>
        </motion.div>
    );
}

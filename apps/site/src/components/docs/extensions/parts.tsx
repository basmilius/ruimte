'use client';

import { Icon, Kbd } from '@adecore/ui';
import { Blocks, ChevronRight, Maximize, MessageSquare, Scan, StickyNote, Terminal } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
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

/*
 * `canvas/CanvasMenu.tsx`, shortened: what to add, the Extensions submenu with the nodes extensions add,
 * what to do with the canvas, then the `canvasMenu` slot under a separator. Its overflow stays visible, so
 * an open submenu or the label of a slot can stand beside or under it.
 */
export function CanvasMenu({
    className,
    nodes,
    slot
}: {
    readonly className: string;

    /* The open Extensions submenu's rows. */
    readonly nodes?: ReactNode;
    readonly slot?: ReactNode;
}) {
    return (
        <div className={`menu-popup absolute z-10 flex w-[224px] flex-col overflow-visible ${className}`}>
            <span className="menu-item">
                <Icon icon={Terminal} size={14} /> Terminal <Kbd>⌥T</Kbd>
            </span>
            <span className="menu-item">
                <Icon icon={MessageSquare} size={14} /> Chat <Kbd>⌥C</Kbd>
            </span>
            <span className="menu-item">
                <Icon icon={StickyNote} size={14} /> Note <Kbd>⌥N</Kbd>
            </span>
            {nodes !== undefined && (
                <span className="menu-item relative bg-surface-active">
                    <Icon icon={Blocks} size={14} /> Extensions
                    <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
                    <span className="menu-popup absolute top-[-5px] left-[calc(100%+8px)] flex min-w-44 flex-col">{nodes}</span>
                </span>
            )}
            <span role="separator" className="-mx-1 my-1 h-px bg-border-soft" />
            <span className="menu-item">
                <Icon icon={Scan} size={14} /> Select all <Kbd>⌘A</Kbd>
            </span>
            <span className="menu-item">
                <Icon icon={Maximize} size={14} /> Zoom to fit <Kbd>⇧1</Kbd>
            </span>
            {slot !== undefined && (
                <>
                    <span role="separator" className="-mx-1 my-1 h-px bg-border-soft" />
                    {slot}
                </>
            )}
        </div>
    );
}

/* A note's body, the brief most scenes start from. */
export function NoteText({ children }: { readonly children: ReactNode }) {
    return <div className="px-3 py-2.5 text-[14px] leading-[21px]">{children}</div>;
}

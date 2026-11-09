'use client';

import { animate, AnimatePresence, motion, useMotionValue } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { PHANTOM_ARROW, PHANTOM_BEAM, PHANTOM_COLORS, SMOOTH, travelPoint, travelTime } from './phantom.ts';

export type PhantomMode = 'move' | 'look' | 'click' | 'type' | 'paused';

const MORPH = { duration: 0.38, ease: SMOOTH } as const;
const TRAVEL_EASE = [0.45, 0, 0.2, 1] as const;
const SHADOW = 'drop-shadow(0 0.5px 0.8px rgb(0 0 0 / 0.35))';
const MARK_SHADOW = 'drop-shadow(0 0.7px 1.3px rgb(0 0 0 / 0.32))';

// The notch of the arrow, and the line from the tip through it along which every sign sits.
const NOTCH = [13.5, 13.5] as const;
const TAIL = [9.5 / Math.hypot(9.5, 10), 10 / Math.hypot(9.5, 10)] as const;
const CLEARANCE = 6.5;

/* The corner of a sign whose corner circle has `radius`, so its nearest point is the clearance from the notch. */
function place(radius: number): readonly [number, number] {
    const reach = CLEARANCE + radius;
    return [NOTCH[0] + TAIL[0] * reach - radius, NOTCH[1] + TAIL[1] * reach - radius];
}

const DISC_RADIUS = 7;
const DISC_CORNER = place(DISC_RADIUS);
const DISC = [DISC_CORNER[0] + DISC_RADIUS, DISC_CORNER[1] + DISC_RADIUS] as const;
const FRAME = place(3);

// `step-end`: each step holds until the next.
const STEP_END = (progress: number) => (progress < 1 ? 0 : 1);

/**
 * The agent's own cursor from computer use (`apps/computer-use/Sources/Phantom`): graphite with a white rim,
 * a text cursor while it types, and a sign at the notch of the arrow. It travels on an arc that bows up the
 * screen and takes longer the further it goes.
 */
export function PhantomCursor({ x, y, mode }: { readonly x: number; readonly y: number; readonly mode: PhantomMode }) {
    const left = useMotionValue(x - 4);
    const top = useMotionValue(y - 3.5);
    const from = useRef<readonly [number, number]>([x, y]);
    const [arrival, setArrival] = useState(0);

    useEffect(() => {
        const start = from.current;
        const end = [x, y] as const;
        from.current = end;
        const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
        if (distance < 1) {
            setArrival(0);
            return;
        }
        const duration = travelTime(distance);
        setArrival(duration);
        const travel = animate(0, 1, {
            duration,
            ease: TRAVEL_EASE,
            onUpdate: (t) => {
                const [px, py] = travelPoint(start, end, t);
                left.set(px - 4);
                top.set(py - 3.5);
            }
        });
        return () => travel.stop();
    }, [x, y, left, top]);

    const path = mode === 'type' ? PHANTOM_BEAM : PHANTOM_ARROW;

    return (
        <motion.div className="pointer-events-none absolute top-0 left-0 z-30" style={{ x: left, y: top }}>
            {mode === 'click' && (
                <motion.svg
                    key={`${x}-${y}`}
                    width={24}
                    height={24}
                    viewBox="0 0 24 24"
                    className="absolute top-0 left-0 overflow-visible"
                    style={{ filter: MARK_SHADOW, transformOrigin: '4px 3.5px' }}
                    initial={{ scale: 0.45, opacity: 0 }}
                    animate={{ scale: 1, opacity: [0, 0.9, 0] }}
                    transition={{ duration: 0.6, delay: arrival, ease: SMOOTH, opacity: { duration: 0.6, delay: arrival, times: [0, 0.18, 1], ease: SMOOTH } }}
                >
                    <circle cx={4} cy={3.5} r={13} fill="none" stroke={PHANTOM_COLORS.rim} strokeWidth={1.6} />
                </motion.svg>
            )}
            <motion.svg
                width={24}
                height={24}
                viewBox="0 0 24 24"
                className="overflow-visible"
                style={{ filter: SHADOW, transformOrigin: '4px 3.5px' }}
                animate={mode === 'click' ? { scale: [1, 0.9, 1] } : mode === 'type' ? { x: [0, 1.4, 2.8, 4.2, 4.2, 0] } : { scale: 1, x: 0 }}
                transition={
                    mode === 'click'
                        ? { duration: 0.5, delay: arrival, times: [0, 0.35, 1], ease: SMOOTH }
                        : mode === 'type'
                          ? { duration: 2, times: [0, 0.2, 0.4, 0.6, 0.85, 1], ease: STEP_END, repeat: Infinity }
                          : { duration: 0.2 }
                }
            >
                <motion.path
                    d={path}
                    fill="none"
                    stroke={PHANTOM_COLORS.rim}
                    strokeWidth={mode === 'type' ? 3.2 : 6}
                    strokeLinejoin="round"
                    initial={false}
                    animate={{ d: path }}
                    transition={MORPH}
                />
                <motion.path
                    d={path}
                    fill={PHANTOM_COLORS.ink}
                    stroke={PHANTOM_COLORS.ink}
                    strokeWidth={1}
                    strokeLinejoin="round"
                    initial={false}
                    animate={{ d: path }}
                    transition={MORPH}
                />
            </motion.svg>
            <AnimatePresence>
                {mode === 'look' && <LookMark key="look" />}
                {mode === 'paused' && <PausedMark key="paused" />}
            </AnimatePresence>
        </motion.div>
    );
}

/** Four white rounded corners that focus from outside in. */
function LookMark() {
    const [left, top] = FRAME;
    const right = left + 20;
    const bottom = top + 14;
    const arm = 4.4;
    const bend = 2.2;
    const corners = [
        `M${left} ${top + arm} V${top + bend} Q${left} ${top} ${left + bend} ${top} H${left + arm}`,
        `M${right - arm} ${top} H${right - bend} Q${right} ${top} ${right} ${top + bend} V${top + arm}`,
        `M${right} ${bottom - arm} V${bottom - bend} Q${right} ${bottom} ${right - bend} ${bottom} H${right - arm}`,
        `M${left + arm} ${bottom} H${left + bend} Q${left} ${bottom} ${left} ${bottom - bend} V${bottom - arm}`
    ];
    return (
        <motion.svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            className="absolute top-0 left-0 overflow-visible"
            style={{ filter: MARK_SHADOW, transformOrigin: `${left + 10}px ${top + 7}px` }}
            initial={{ scale: 1.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={{ duration: 0.5, ease: SMOOTH }}
        >
            {corners.map((d) => (
                <path key={d} d={d} fill="none" stroke={PHANTOM_COLORS.rim} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            ))}
        </motion.svg>
    );
}

/** A gray disc with white pause bars, grown out of the notch. */
function PausedMark() {
    const [cx, cy] = DISC;
    return (
        <motion.svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            className="absolute top-0 left-0 overflow-visible"
            style={{ filter: MARK_SHADOW, transformOrigin: `${NOTCH[0]}px ${NOTCH[1]}px` }}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={{ duration: 0.34, ease: SMOOTH }}
        >
            <circle cx={cx} cy={cy} r={DISC_RADIUS} fill={PHANTOM_COLORS.paused} />
            {/* The bars are drawn for a disc of radius 6 and grow with it. */}
            <g transform={`translate(${cx} ${cy}) scale(${DISC_RADIUS / 6})`} fill="#ffffff">
                <rect x={-2.1} y={-2.25} width={1.6} height={4.5} rx={0.5} />
                <rect x={0.5} y={-2.25} width={1.6} height={4.5} rx={0.5} />
            </g>
        </motion.svg>
    );
}

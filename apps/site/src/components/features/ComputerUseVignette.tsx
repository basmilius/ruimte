'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { TrafficLights, Typed } from '../app/primitives.tsx';
import { PHANTOM_ARROW, PHANTOM_COLORS } from '../film/phantom.ts';
import { PhantomCursor, type PhantomMode } from '../film/PhantomCursor.tsx';
import { EASE, usePlayback, useTimeline } from '../film/playback.ts';
import { Stage } from '../film/Stage.tsx';

// look, click, type, add, added, paused (held)
const STEPS = [1700, 1300, 2100, 1100, 1400, 2800] as const;

const DAYS = ['Mon 21', 'Tue 22', 'Wed 23', 'Thu 24', 'Fri 25'] as const;

interface Pose {
    readonly x: number;
    readonly y: number;
    readonly mode: PhantomMode;
    readonly label?: string;
    readonly typed?: boolean;
}

const POSES: readonly Pose[] = [
    { x: 420, y: 298, mode: 'think', label: 'Looking at Calendar' },
    { x: 766, y: 84, mode: 'click', label: 'New event' },
    { x: 630, y: 154, mode: 'move', label: 'Design review', typed: true },
    { x: 706, y: 236, mode: 'click', label: 'Add' },
    { x: 560, y: 328, mode: 'move' },
    { x: 560, y: 328, mode: 'paused', label: 'Paused' }
];

export function ComputerUseVignette() {
    return (
        <Stage
            width={900}
            height={600}
            label="An agent works in a calendar app with a cursor of its own, adds a design review on Thursday, and pauses when the person presses Option Space."
        >
            <ComputerUse />
        </Stage>
    );
}

function ComputerUse() {
    const step = useTimeline(STEPS);
    const { playing } = usePlayback();
    const [seconds, setSeconds] = useState(12);
    const paused = step >= 5;
    const pose = POSES[step];

    useEffect(() => {
        if (!playing || paused) {
            return;
        }
        const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000);
        return () => window.clearInterval(timer);
    }, [playing, paused]);

    return (
        <div className="absolute inset-0">
            <SessionBar paused={paused} time={`00:${String(seconds % 60).padStart(2, '0')}`} />

            <div className="absolute top-[64px] left-[70px] flex h-[510px] w-[760px] flex-col overflow-hidden rounded-[12px] border border-white/10 bg-[#1e1e22] shadow-[0_30px_80px_-10px_rgb(0_0_0/0.7)]">
                <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
                    <TrafficLights />
                    <span className="ml-2 text-[15px] font-semibold text-white">September 2026</span>
                    <span className="grow" />
                    <span className="flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-[13px] text-white">
                        <Plus size={14} /> New event
                    </span>
                </div>
                <div className="grid grow grid-cols-5">
                    {DAYS.map((day, i) => (
                        <div key={day} className="relative border-r border-white/[0.06] last:border-r-0">
                            <div className="border-b border-white/[0.06] px-3 py-2 text-[13px] text-white/60">{day}</div>
                            {i === 0 && <Event top={70} title="Standup" time="09:30" color="#a78bfa" />}
                            {i === 2 && <Event top={160} title="Planning" time="11:00" color="#34d399" />}
                            {i === 3 && (
                                <AnimatePresence>
                                    {step >= 4 && (
                                        <motion.div
                                            key="review"
                                            initial={{ opacity: 0, scale: 0.9 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.35, ease: EASE }}
                                        >
                                            <Event top={230} title="Design review" time="14:00" color="#60a5fa" />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            )}
                        </div>
                    ))}
                </div>

                <AnimatePresence>
                    {step >= 2 && step < 4 && (
                        <motion.div
                            className="absolute top-14 right-4 w-[270px] rounded-xl border border-white/10 bg-[#2a2a2f] p-4 text-[13px] text-white shadow-[0_20px_40px_-10px_rgb(0_0_0/0.6)]"
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.25 }}
                        >
                            <div className="text-white/60">Title</div>
                            <div className="mt-1 h-8 rounded-md border border-white/15 bg-black/20 px-2 leading-8">
                                <Typed shown={step >= 2} speed={85} text="Design review" caret={step === 2} />
                            </div>
                            <div className="mt-3 flex justify-between text-white/60">
                                <span>Thursday</span>
                                <span>14:00</span>
                            </div>
                            <div className="mt-3 rounded-md bg-[#0a84ff] py-1.5 text-center font-medium">Add</div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <PhantomCursor x={pose.x} y={pose.y} mode={pose.mode} label={pose.label} typed={pose.typed} />
        </div>
    );
}

function Event({ top, title, time, color }: { readonly top: number; readonly title: string; readonly time: string; readonly color: string }) {
    return (
        <div
            className="absolute inset-x-2 rounded-md border-l-[3px] px-2 py-1.5 text-[13px] text-white"
            style={{ top, borderColor: color, background: `color-mix(in srgb, ${color} 22%, transparent)` }}
        >
            <div className="font-medium">{title}</div>
            <div className="text-white/60">{time}</div>
        </div>
    );
}

/** The quiet bar at the top of the screen (`SessionBarLayer.swift`): the agent's mark, the title, the time, pause and stop. */
function SessionBar({ paused, time }: { readonly paused: boolean; readonly time: string }) {
    return (
        <div className="absolute top-2 left-1/2 flex h-9 -translate-x-1/2 items-center gap-2 rounded-[10px] border border-border bg-surface-raised pr-1 pl-2.5 text-[14px] shadow-float">
            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden>
                <path
                    d={PHANTOM_ARROW}
                    fill={paused ? PHANTOM_COLORS.muted : PHANTOM_COLORS.accent}
                    stroke="#ffffff"
                    strokeWidth={3}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    transform="translate(-2 -1) scale(1.1)"
                />
            </svg>
            <span className="text-text">Ruimte is using Calendar in the background</span>
            <span className="min-w-[38px] text-text-faint tabular-nums">{time}</span>
            <span className="flex gap-0.5">
                <span className="grid size-7 place-items-center rounded-lg text-text-muted">
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        {paused ? (
                            <path d="M7 2.66 L21.94 12 L7 21.34 Z" />
                        ) : (
                            <>
                                <rect x={6} y={4} width={4} height={16} rx={1.5} />
                                <rect x={14} y={4} width={4} height={16} rx={1.5} />
                            </>
                        )}
                    </svg>
                </span>
                <span className="grid size-7 place-items-center rounded-lg text-text-muted">
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <rect x={5} y={5} width={14} height={14} rx={2.5} />
                    </svg>
                </span>
            </span>
        </div>
    );
}

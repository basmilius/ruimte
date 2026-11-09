'use client';

import { Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { TrafficLights, Typed } from '../app/primitives.tsx';
import { PHANTOM_ARROW, PHANTOM_COLORS } from '../film/phantom.ts';
import { PhantomCursor, type PhantomMode } from '../film/PhantomCursor.tsx';
import { EASE, usePlayback, useTimeline } from '../film/playback.ts';
import { Stage } from '../film/Stage.tsx';

// look, click, type, add, added, paused (held, with the menu open)
const STEPS = [1700, 1300, 2100, 1100, 1400, 3200] as const;

const DAYS = ['Mon 21', 'Tue 22', 'Wed 23', 'Thu 24', 'Fri 25'] as const;

interface Pose {
    readonly x: number;
    readonly y: number;
    readonly mode: PhantomMode;
}

const POSES: readonly Pose[] = [
    { x: 420, y: 318, mode: 'look' },
    { x: 766, y: 104, mode: 'click' },
    { x: 630, y: 174, mode: 'type' },
    { x: 706, y: 256, mode: 'click' },
    { x: 560, y: 348, mode: 'move' },
    { x: 560, y: 348, mode: 'paused' }
];

export function ComputerUseVignette() {
    return (
        <Stage
            width={900}
            height={600}
            label="An agent works in a calendar app with a cursor of its own and adds a design review on Thursday. The person presses Option Space to pause it, and Ruimte's menu in the menu bar offers Resume."
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
    const pose = POSES[step]!;
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

    useEffect(() => {
        if (!playing || paused) {
            return;
        }
        const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000);
        return () => window.clearInterval(timer);
    }, [playing, paused]);

    return (
        <div className="absolute inset-0">
            <MenuBar time={time} open={paused} />

            <div className="absolute top-[84px] left-[70px] flex h-[490px] w-[760px] flex-col overflow-hidden rounded-[12px] border border-white/10 bg-[#1e1e22] shadow-[0_30px_80px_-10px_rgb(0_0_0/0.7)]">
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

            <PhantomCursor x={pose.x} y={pose.y} mode={pose.mode} />
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

/** The Mac's menu bar with Ruimte's item (`StatusMenu.swift`): the arrow and the time, and its menu while the agent is paused. */
function MenuBar({ time, open }: { readonly time: string; readonly open: boolean }) {
    return (
        <div className="absolute inset-x-0 top-0 z-40 flex h-7 items-center gap-5 bg-black/35 px-4 text-[13px] text-white/90 backdrop-blur">
            <span className="font-semibold">Calendar</span>
            <span>File</span>
            <span>Edit</span>
            <span>View</span>
            <span className="grow" />
            <span className="relative">
                <span className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 tabular-nums ${open ? 'bg-white/20' : ''}`}>
                    <svg width={10} height={14} viewBox="4 0 17 24" aria-hidden>
                        <path d={PHANTOM_ARROW} fill="currentColor" />
                    </svg>
                    {time}
                </span>
                <AnimatePresence>{open && <Menu key="menu" time={time} />}</AnimatePresence>
            </span>
            <span className="tabular-nums">Thu 14:02</span>
        </div>
    );
}

function Menu({ time }: { readonly time: string }) {
    return (
        <motion.div
            className="absolute top-8 right-0 w-[300px] rounded-xl border border-white/10 bg-[#2a2a2f]/95 p-[5px] text-[13px] text-white shadow-[0_12px_32px_-8px_rgb(0_0_0/0.6)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, delay: 0.4 }}
        >
            <div className="flex items-start gap-2.5 px-[9px] pt-2 pb-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg ring-1 ring-white/10" style={{ background: PHANTOM_COLORS.ink }}>
                    <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden>
                        <path d={PHANTOM_ARROW} fill="#ffffff" />
                    </svg>
                </span>
                <span>
                    <span className="block font-semibold">Ruimte is using Calendar in the background</span>
                    <span className="text-white/55 tabular-nums">Paused · {time}</span>
                </span>
            </div>
            <MenuItem shortcut="⌥Space">Resume</MenuItem>
            <MenuItem>Take over</MenuItem>
            <div className="mx-[9px] my-[5px] h-px bg-white/10" />
            <MenuItem shortcut="⌥Esc" danger>
                Stop session
            </MenuItem>
        </motion.div>
    );
}

function MenuItem({ children, shortcut, danger = false }: { readonly children: string; readonly shortcut?: string; readonly danger?: boolean }) {
    return (
        <div className={`flex justify-between rounded-md px-[9px] py-1 ${danger ? 'text-[#ff6961]' : ''}`}>
            <span>{children}</span>
            {shortcut && <span className="text-white/45">{shortcut}</span>}
        </div>
    );
}

'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, Laptop, Terminal } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { TerminalBody } from '../app/bodies.tsx';
import { ClaudeMark, StatusDot } from '../app/canvas.tsx';
import { CellToolbar } from '../app/chrome.tsx';
import { TrafficLights } from '../app/primitives.tsx';
import { EASE, usePlayback, useTimeline } from '../film/playback.ts';
import { Stage } from '../film/Stage.tsx';

// open, closed, reopened (held)
const STEPS = [2800, 3200, 3600] as const;
const FILES = [
    'cart/total',
    'cart/discount',
    'checkout/address',
    'checkout/payment',
    'orders/list',
    'orders/refund',
    'auth/session',
    'auth/reset',
    'search/index',
    'search/rank',
    'mail/receipt'
];
const VISIBLE = 13;

const FLOAT = 'border border-border bg-[color-mix(in_srgb,var(--surface-raised)_88%,transparent)] shadow-float backdrop-blur-[14px]';

export function SessionsVignette() {
    return (
        <Stage
            width={640}
            height={460}
            label="A terminal runs a test suite. The window closes, the machine keeps the session running, and the reopened window shows every line that came in meanwhile."
        >
            <Sessions />
        </Stage>
    );
}

function Sessions() {
    const step = useTimeline(STEPS);
    const { playing } = usePlayback();
    const [tick, setTick] = useState(30);
    const open = step !== 1;

    useEffect(() => {
        if (!playing) {
            return;
        }
        const timer = window.setInterval(() => setTick((current) => current + 1), 360);
        return () => window.clearInterval(timer);
    }, [playing]);

    return (
        <div className="absolute inset-0">
            <motion.div
                className="absolute top-6 left-6 flex h-[410px] w-[592px] flex-col overflow-hidden rounded-[12px] border border-white/10 bg-bg shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]"
                initial={false}
                animate={{ opacity: open ? 1 : 0, scale: open ? 1 : 0.9, y: open ? 0 : 24 }}
                transition={{ duration: 0.55, ease: EASE }}
            >
                <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
                    <TrafficLights />
                    <span className="text-[13px] text-text-muted">acme-web</span>
                </div>
                <CellToolbar icon={Terminal} name="test suite" focused>
                    <StatusDot status="running" />
                </CellToolbar>
                <div className="relative grow">
                    <TerminalBody>
                        {Array.from({ length: VISIBLE }, (_, i) => tick - VISIBLE + i).map((line) => (
                            <div key={line}>
                                <span className="text-ansi-green">✓</span> src/{FILES[line % FILES.length]}.test.ts{' '}
                                <span className="text-term-dim">({3 + ((line * 7) % 23)} tests)</span>
                            </div>
                        ))}
                        <div className="text-term-dim">
                            {tick * 11} passed <span className="caret inline-block h-[13px] w-[7px] translate-y-[2px] bg-accent" />
                        </div>
                    </TerminalBody>
                </div>
            </motion.div>

            <motion.div
                className={`absolute top-[110px] left-[150px] w-[340px] rounded-[10px] p-4 ${FLOAT}`}
                initial={false}
                animate={{ opacity: open ? 0 : 1, scale: open ? 0.96 : 1 }}
                transition={{ duration: 0.4, ease: EASE, delay: open ? 0 : 0.3 }}
            >
                <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-lg bg-surface-sunken text-text-muted">
                        <Laptop size={18} strokeWidth={1.75} />
                    </span>
                    <div>
                        <div className="text-[14px] font-medium text-text">Window closed</div>
                        <div className="text-[13px] text-text-muted">This machine keeps 3 sessions running</div>
                    </div>
                </div>
                <div className="mt-4 space-y-2 text-[14px]">
                    {[
                        ['test suite', `${tick * 11} passed`],
                        ['dev server', ':5173'],
                        ['Fix signup', 'Working']
                    ].map(([name, detail]) => (
                        <div key={name} className="flex items-center gap-2.5">
                            {name === 'Fix signup' ? (
                                <ClaudeMark className="text-text-muted" />
                            ) : (
                                <Terminal size={14} strokeWidth={1.75} className="text-text-muted" />
                            )}
                            <span className="grow text-text">{name}</span>
                            <span className="font-mono text-[12px] text-text-muted tabular-nums">{detail}</span>
                            <StatusDot status="running" />
                        </div>
                    ))}
                </div>
            </motion.div>

            <AnimatePresence>
                {step === 2 && (
                    <motion.div
                        className={`absolute right-10 bottom-10 flex w-[280px] items-start gap-3 rounded-[10px] py-2.5 pr-2 pl-3 ${FLOAT}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.35, ease: EASE, delay: 0.5 }}
                    >
                        <CircleCheck size={16} strokeWidth={1.75} className="mt-0.5 text-status-idle" />
                        <div>
                            <div className="text-[14px] text-text">Back where you left it</div>
                            <div className="text-[13px] text-text-muted">Scrollback included</div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

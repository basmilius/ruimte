'use client';

import { Check, CircleCheck, Hand, Laptop, Monitor, Server } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type AgentStatus, CanvasEdge, ClaudeMark, StatusDot } from '../app/canvas.tsx';
import type { Rect } from '../app/edge-route.ts';
import { Button, Typed } from '../app/primitives.tsx';
import { EASE, useTimeline } from '../film/playback.ts';
import { Stage } from '../film/Stage.tsx';

// working, asks, tap, allowed (held)
const STEPS = [1800, 2000, 800, 3000] as const;

const MACHINES = [
    { name: 'MacBook Pro', detail: 'This Mac', icon: Laptop, y: 0 },
    { name: 'build-box', detail: 'Linux, paired', icon: Server, y: 1 },
    { name: 'studio', detail: 'Mac mini, paired', icon: Monitor, y: 2 }
] as const;

const PHONE: Rect = { x: 424, y: 20, w: 200, h: 420 };

export function MachinesVignette() {
    return (
        <Stage
            width={640}
            height={460}
            label="Three paired machines and an iPhone. An agent on the Linux build machine asks to deploy, and the person allows it from the phone."
        >
            <Machines />
        </Stage>
    );
}

function Machines() {
    const step = useTimeline(STEPS);
    const asking = step === 1 || step === 2;
    const buildStatus: AgentStatus = asking ? 'needs-you' : 'running';

    return (
        <div className="absolute inset-0">
            {MACHINES.map((machine) => (
                <CanvasEdge
                    key={machine.name}
                    from={{ x: 24, y: 134 + machine.y * 52, w: 294, h: 52 }}
                    to={PHONE}
                    look={machine.y === 1 ? 'context' : 'plain'}
                    active={machine.y === 1 && asking}
                />
            ))}

            <div className="absolute top-[96px] left-6 w-[294px] rounded-xl border border-border bg-surface p-1.5 shadow-node">
                <div className="px-2 py-1.5 text-[13px] font-medium text-text-faint">Machines</div>
                {MACHINES.map(({ name, detail, icon: Icon }) => (
                    <div key={name} className={`flex h-[52px] items-center gap-3 rounded-lg px-2 ${name === 'build-box' ? 'bg-surface-active' : ''}`}>
                        <span className="grid size-8 place-items-center rounded-lg bg-surface-sunken text-text-muted">
                            <Icon size={16} strokeWidth={1.75} />
                        </span>
                        <div className="min-w-0 grow">
                            <div className="text-[14px] font-medium text-text">{name}</div>
                            <div className="text-[13px] text-text-muted">{detail}</div>
                        </div>
                        <StatusDot status={name === 'build-box' ? buildStatus : 'idle'} />
                    </div>
                ))}
            </div>

            <div className="absolute top-5 left-[424px] h-[420px] w-[200px] overflow-hidden rounded-[34px] border-[6px] border-[#26262d] bg-bg shadow-[0_30px_60px_-20px_rgb(0_0_0/0.8)]">
                <div className="mx-auto mt-2 h-5 w-16 rounded-full bg-black" />
                <div className="mt-2 flex items-center gap-1.5 border-b border-border px-3 pb-2 text-[12px] font-medium text-text">
                    <ClaudeMark size={12} className="text-text-muted" />
                    <span className="grow">Deploy</span>
                    <StatusDot status={buildStatus} />
                </div>
                <div className="space-y-2.5 p-3 text-[12px] leading-[17px]">
                    <div className="ml-6 rounded-xl bg-surface-active px-2.5 py-1.5 text-text">Run the tests on build-box, then deploy.</div>
                    <Typed shown text="All 412 tests pass on build-box. Ready to deploy." words speed={18} className="block text-text" />
                    <AnimatePresence mode="wait" initial={false}>
                        {asking && (
                            <motion.div
                                key="ask"
                                className="rounded-xl border border-border bg-surface-raised p-2.5"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.3, ease: EASE }}
                            >
                                <div className="flex items-center gap-1.5 font-semibold text-text">
                                    <Hand size={13} strokeWidth={1.75} className="text-status-needs-you" /> Run command
                                </div>
                                <div className="mt-1.5 rounded-lg bg-surface-sunken p-2 font-mono text-[11px] text-text">./deploy.sh production</div>
                                <div className="mt-2 flex justify-end gap-1">
                                    <Button size="xs">Deny</Button>
                                    <Button size="xs" variant="inverse" className="relative">
                                        <CircleCheck size={12} strokeWidth={1.75} /> Allow
                                        {step === 2 && (
                                            <motion.span
                                                className="absolute inset-0 m-auto size-7 rounded-full bg-white/50"
                                                initial={{ scale: 0.3, opacity: 1 }}
                                                animate={{ scale: 1.8, opacity: 0 }}
                                                transition={{ duration: 0.6 }}
                                            />
                                        )}
                                    </Button>
                                </div>
                            </motion.div>
                        )}
                        {step === 3 && (
                            <motion.div key="allowed" className="space-y-1.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                <div className="flex items-center gap-1.5 text-text-muted">
                                    <Check size={12} className="text-status-idle" /> Allowed <span className="font-mono text-text-faint">./deploy.sh</span>
                                </div>
                                <div className="shine">Deploying</div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}

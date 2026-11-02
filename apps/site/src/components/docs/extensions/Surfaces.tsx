'use client';

import type { ReactNode } from 'react';
import { Gauge, Hash, ListChecks, StickyNote, X } from 'lucide-react';
import { motion } from 'motion/react';
import { CanvasNode } from '../../app/canvas.tsx';
import { AppWindow, Rail, Sidebar, TopRow } from '../../app/chrome.tsx';
import { Button, IconButton } from '../../app/primitives.tsx';
import { EASE, useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1400, 1600, 1600, 2800] as const;
const NOTE = { x: 32, y: 32, w: 236, h: 148 };
const COUNTER = { x: 300, y: 64, w: 200, h: 148 };

/* What an extension draws itself, arriving one by one: a node, a panel, a view in the sidebar and an overlay. */
export function Surfaces() {
    return (
        <Stage
            width={960}
            height={540}
            label="A node of an extension appears on the canvas, then its panel beside it, its view in the sidebar, and an overlay over the window."
        >
            <SurfacesScene />
        </Stage>
    );
}

function Appear({ shown, className = '', children }: { readonly shown: boolean; readonly className?: string; readonly children: ReactNode }) {
    return (
        <motion.div
            className={className}
            initial={false}
            animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 8, scale: shown ? 1 : 0.98 }}
            transition={{ duration: 0.4, ease: EASE }}
        >
            {children}
        </motion.div>
    );
}

function SurfacesScene() {
    const step = useTimeline(STEPS);

    return (
        <div className="absolute inset-0">
            <AppWindow
                sidebar={
                    <Sidebar
                        waiting={[]}
                        rows={[
                            { id: 'signup', name: 'Signup', icon: Hash, selected: true },
                            { id: 'brief', name: 'Brief', icon: StickyNote, nested: true },
                            ...(step >= 2 ? [{ id: 'dashboard', name: 'Dashboard', icon: Gauge }] : [])
                        ]}
                    />
                }
                toolbar={<TopRow view={{ icon: Hash, name: 'Signup' }} />}
                rail={<Rail />}
            >
                <div className="absolute inset-0 flex">
                    <div className="canvas-dots relative grow">
                        <CanvasNode rect={NOTE} kind="note" title="Brief">
                            <div className="px-3 py-2.5 text-[14px] leading-[21px] text-text-muted">Keep the email after a failed submit.</div>
                        </CanvasNode>
                        <CanvasNode rect={COUNTER} kind="file" title="Counter" shown={step >= 0}>
                            <div className="grid h-full place-items-center pb-4">
                                <span className="font-display text-[44px] leading-none font-semibold text-text tabular-nums">42</span>
                            </div>
                        </CanvasNode>
                    </div>
                    <motion.aside
                        className="flex shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
                        initial={false}
                        animate={{ width: step >= 1 ? 232 : 0 }}
                        transition={{ duration: 0.45, ease: EASE }}
                    >
                        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3 text-[13px] font-medium whitespace-nowrap text-text">
                            <ListChecks size={14} strokeWidth={1.75} className="text-text-muted" />
                            Review
                            <span className="grow" />
                            <IconButton icon={X} size="sm" />
                        </div>
                        <div className="flex flex-col gap-1 p-2 text-[13px] whitespace-nowrap">
                            {['Keeps the email', 'Shows the error', 'Focus moves to it'].map((item, index) => (
                                <span key={item} className="flex h-8 items-center gap-2 rounded-md px-2 text-text-muted">
                                    <span className={`size-2 rounded-full ${index < 2 ? 'bg-status-idle' : 'bg-text-faint'}`} />
                                    {item}
                                </span>
                            ))}
                        </div>
                    </motion.aside>
                </div>
            </AppWindow>
            <Appear shown={step === 3} className="absolute inset-0 z-30 grid place-items-center bg-black/35">
                <div className="flex w-[340px] flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-float">
                    <div className="flex h-11 items-center border-b border-border pr-2 pl-4 text-[14px] font-medium text-text">
                        Rename
                        <span className="grow" />
                        <IconButton icon={X} size="sm" />
                    </div>
                    <div className="flex flex-col gap-3 p-4">
                        <span className="flex h-9 items-center rounded-md border border-border bg-surface-sunken px-3 text-[14px] text-text">Signup flow</span>
                        <span className="flex justify-end gap-2">
                            <Button variant="secondary">Cancel</Button>
                            <Button variant="primary">Rename</Button>
                        </span>
                    </div>
                </div>
            </Appear>
        </div>
    );
}

'use client';

import type { ReactNode } from 'react';
import { Gauge, Hash, ListChecks, StickyNote, X } from 'lucide-react';
import { motion } from 'motion/react';
import { PanelHeader } from '@adecore/ui';
import { CanvasNode } from '../../app/canvas.tsx';
import { AppWindow, Rail, Sidebar, TopRow } from '../../app/chrome.tsx';
import { Button, IconButton } from '../../app/primitives.tsx';
import { EASE, useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';
import { NoteText } from './parts.tsx';

const STEPS = [1400, 1800, 1600, 1600, 2800] as const;
const NOTE = { x: 28, y: 28, w: 236, h: 132 };
const COUNTER = { x: 96, y: 196, w: 200, h: 148 };
const PANEL_WIDTH = 260;
const CHECKS = ['Keeps the email', 'Shows the error', 'Focus moves to it'] as const;

/* What an extension draws itself, arriving one by one: a node, a panel, a view, a sidebar card and an overlay. */
export function Surfaces() {
    return (
        <Stage
            width={960}
            height={540}
            label="A node of an extension appears on the canvas. Its panel opens from the rail, its view joins the sidebar, a card appears at the sidebar's foot, and an overlay opens over the window."
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
    const panelOpen = step >= 1;

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
                        cards={<TodayCard shown={step >= 3} />}
                    />
                }
                toolbar={<TopRow view={{ icon: Hash, name: 'Signup' }} />}
                rail={<Rail extension={{ icon: ListChecks, open: panelOpen }} />}
                sidePanel={<ReviewPanel open={panelOpen} />}
            >
                <div className="canvas-dots absolute inset-0">
                    <CanvasNode rect={NOTE} kind="note" title="Brief">
                        <NoteText>
                            <p className="text-text-muted">Keep the email after a failed submit.</p>
                        </NoteText>
                    </CanvasNode>
                    <CanvasNode rect={COUNTER} kind="file" icon={Hash} title="Counter">
                        <div className="grid h-full place-items-center pb-4">
                            <span className="font-display text-4xl leading-none font-semibold text-text tabular-nums">42</span>
                        </div>
                    </CanvasNode>
                </div>
            </AppWindow>
            <Appear shown={step === 4} className="absolute inset-0 z-30 grid place-items-center rounded-[12px] bg-bg/55">
                <RenameOverlay />
            </Appear>
        </div>
    );
}

/* `shell/Panel.tsx`: behind the sheet, its name in the header, closed again from its toggle in the rail. */
function ReviewPanel({ open }: { readonly open: boolean }) {
    return (
        <motion.aside
            className="flex shrink-0 flex-col overflow-hidden"
            initial={false}
            animate={{ width: open ? PANEL_WIDTH : 0 }}
            transition={{ duration: 0.45, ease: EASE }}
        >
            <div className="flex h-full flex-col" style={{ width: PANEL_WIDTH }}>
                <PanelHeader title="Review" />
                <div className="flex flex-col gap-px p-2 text-2xs">
                    {CHECKS.map((check, index) => (
                        <span key={check} className="flex h-8 items-center gap-2 rounded-md px-2 text-text-muted">
                            <span className={`size-2 rounded-full ${index < 2 ? 'bg-status-idle' : 'bg-text-faint'}`} />
                            {check}
                        </span>
                    ))}
                </div>
            </div>
        </motion.aside>
    );
}

/* `extensions/SidebarCards.tsx`: a bordered card at the sidebar's foot, around the extension's own component. */
function TodayCard({ shown }: { readonly shown: boolean }) {
    return (
        <motion.div
            className="overflow-hidden px-2"
            initial={false}
            animate={{ height: shown ? 'auto' : 0, opacity: shown ? 1 : 0 }}
            transition={{ duration: 0.4, ease: EASE }}
        >
            <section className="mb-2 rounded-lg border border-border p-2 text-2xs">
                <p className="font-medium text-text">Today</p>
                <p className="mt-1 text-text-muted">3 agents finished, 1 waits on you.</p>
            </section>
        </motion.div>
    );
}

/* `extensions/host/host-dialogs.tsx`: Ruimte's dialog with the title and a close button, the extension's body under it. */
function RenameOverlay() {
    return (
        <div className="flex w-[420px] flex-col rounded-[14px] border border-border bg-surface-raised p-5 shadow-float">
            <header className="mb-3 flex items-center gap-2">
                <span className="grow text-base font-semibold text-text">Rename</span>
                <IconButton icon={X} />
            </header>
            <span className="flex h-9 items-center rounded-md border border-border bg-surface-sunken px-3 text-xs text-text">Signup flow</span>
            <span className="mt-4 flex justify-end gap-2">
                <Button variant="secondary">Cancel</Button>
                <Button variant="primary">Rename</Button>
            </span>
        </div>
    );
}

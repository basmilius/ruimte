'use client';

import { useRef } from 'react';
import { Frame, Globe, PenTool, StickyNote, Terminal } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AppWindow, Sidebar, type SidebarRow, Toolbar } from '../app/chrome.tsx';
import { CanvasChapter } from './CanvasChapter.tsx';
import { DelegateChapter } from './DelegateChapter.tsx';
import { GridChapter } from './GridChapter.tsx';
import { CANVAS_STEPS, CHILDREN, chatStatus, childStatus, DELEGATE_STEPS, GRID_STEPS, leadStatus } from './script.ts';
import { EASE, PlaybackContext, useFilm, useStagePlayback } from './playback.ts';
import { Scaled } from './Stage.tsx';

const CHAPTERS = [CANVAS_STEPS, GRID_STEPS, DELEGATE_STEPS] as const;

const TITLES = ['One canvas', 'Views side by side', 'Agents that delegate'] as const;

const LOGS: SidebarRow = { id: 'logs', name: 'logs', icon: Terminal };
const ARCHITECTURE: SidebarRow = { id: 'architecture', name: 'Architecture', icon: PenTool };
const DOCS: SidebarRow = { id: 'docs', name: 'Docs', icon: Globe };

function sidebarOf(chapter: number, step: number): { waiting: SidebarRow[]; rows: (SidebarRow | 'separator')[] } {
    if (chapter === 0) {
        const status = chatStatus(step);
        const chat: SidebarRow = { id: 'fix-signup', name: 'Fix signup', icon: 'claude', nested: true, status, done: step >= 6 };
        return {
            waiting: status === 'needs-you' ? [{ ...chat, id: 'waiting-fix-signup', nested: false }] : [],
            rows: [
                { id: 'signup', name: 'Signup', icon: Frame, selected: true },
                { id: 'dev-server', name: 'dev server', icon: Terminal, nested: true, status: 'running' },
                { id: 'note', name: 'Note', icon: StickyNote, nested: true },
                chat,
                ...(step >= 3 ? [{ id: 'browser', name: 'Sign up', icon: Globe, nested: true } satisfies SidebarRow] : []),
                { id: 'dark-theme', name: 'Dark theme', icon: Frame },
                'separator',
                LOGS,
                ARCHITECTURE,
                DOCS
            ]
        };
    }
    if (chapter === 1) {
        return {
            waiting: [],
            rows: [
                { id: 'signup', name: 'Signup', icon: Frame },
                { id: 'fix-signup-view', name: 'Fix signup', icon: 'claude', selected: step < 4, beside: step >= 4 },
                { id: 'dark-theme', name: 'Dark theme', icon: Frame },
                'separator',
                { ...LOGS, beside: step >= 1 },
                { ...ARCHITECTURE, beside: step >= 2 && step < 4, selected: step >= 4 },
                { ...DOCS, beside: step >= 2 }
            ]
        };
    }
    return {
        waiting: [],
        rows: [
            { id: 'signup', name: 'Signup', icon: Frame },
            { id: 'fix-signup-view', name: 'Fix signup', icon: 'claude' },
            { id: 'dark-theme', name: 'Dark theme', icon: Frame, selected: true },
            { id: 'lead', name: 'Theme lead', icon: 'claude', nested: true, status: leadStatus(step) },
            ...(step >= 2
                ? CHILDREN.map((child): SidebarRow => ({
                      id: child.id,
                      name: child.id,
                      icon: 'claude',
                      nested: true,
                      status: childStatus(child, step),
                      done: step >= child.doneAt
                  }))
                : []),
            'separator',
            LOGS,
            ARCHITECTURE,
            DOCS
        ]
    };
}

/**
 * The app itself, playing: a canvas where an agent asks for approval, views side by side in a grid,
 * and an agent handing out work to three others. Drawn in the DOM from the client's own measures.
 */
export function Film() {
    const ref = useRef<HTMLDivElement>(null);
    const playback = useStagePlayback(ref);
    return (
        <div ref={ref} className="text-left">
            <PlaybackContext value={playback}>
                <FilmBody />
            </PlaybackContext>
        </div>
    );
}

function FilmBody() {
    const { chapter, step, jump } = useFilm(CHAPTERS);
    const { waiting, rows } = sidebarOf(chapter, step);

    return (
        <>
            <Scaled
                width={1280}
                height={800}
                label="The Ruimte app window. On a canvas an agent linked to a terminal, a note and a browser fixes a form and asks to commit; the person allows it. Then four views open side by side in a grid, and finally an agent starts three agents in their own worktrees and merges their work."
            >
                <AppWindow sidebar={<Sidebar waiting={waiting} rows={rows} />} toolbar={<Toolbar />}>
                    <AnimatePresence initial={false}>
                        <motion.div
                            key={chapter}
                            className="absolute inset-0"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.5, ease: EASE }}
                        >
                            {chapter === 0 && <CanvasChapter step={step} />}
                            {chapter === 1 && <GridChapter step={step} />}
                            {chapter === 2 && <DelegateChapter step={step} />}
                        </motion.div>
                    </AnimatePresence>
                </AppWindow>
            </Scaled>
            <ChapterBar chapter={chapter} step={step} jump={jump} />
        </>
    );
}

/** Which part plays, with a line that fills along it; a click starts that part over. */
function ChapterBar({ chapter, step, jump }: { readonly chapter: number; readonly step: number; readonly jump: (chapter: number) => void }) {
    return (
        <div className="mt-6 flex flex-wrap gap-2">
            {TITLES.map((title, i) => {
                const steps = CHAPTERS[i];
                const total = steps.reduce((sum, duration) => sum + duration, 0);
                const passed = steps.slice(0, step).reduce((sum, duration) => sum + duration, 0);
                const active = i === chapter;
                return (
                    <button
                        key={title}
                        type="button"
                        onClick={() => jump(i)}
                        aria-pressed={active}
                        className={`relative overflow-hidden rounded-full border px-4 py-2 text-[15px] font-medium transition-colors ${active ? 'border-border-strong bg-surface-raised text-text' : 'border-border text-text-muted hover:text-text'}`}
                    >
                        {title}
                        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-transparent">
                            {active && (
                                <motion.span
                                    key={`${chapter}-${step}`}
                                    className="block h-full bg-accent"
                                    initial={{ width: `${(passed / total) * 100}%` }}
                                    animate={{ width: `${((passed + steps[step]) / total) * 100}%` }}
                                    transition={{ duration: steps[step] / 1000, ease: 'linear' }}
                                />
                            )}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

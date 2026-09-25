'use client';

import { Check, ChevronDown, Orbit } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { VISUALS, type VisualId } from './catalog.ts';
import { useHeroVisual } from './visual-state.ts';

export function HeroVisualMenu() {
    const { selected, select } = useHeroVisual();
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    const index = VISUALS.findIndex((visual) => visual.id === selected);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointer = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                trigger.current?.focus();
            }
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div
            ref={root}
            className="relative"
            onBlur={(event) => {
                const element = event.currentTarget;
                requestAnimationFrame(() => {
                    if (!element.contains(document.activeElement)) {
                        setOpen(false);
                    }
                });
            }}
        >
            <button
                ref={trigger}
                type="button"
                aria-label={`Choose hero visual, ${VISUALS[index]!.name}, ${index + 1} of ${VISUALS.length}`}
                aria-expanded={open}
                aria-controls={id}
                onClick={() => setOpen((value) => !value)}
                className={`flex min-h-10 items-center gap-2 rounded-full border px-3 transition-colors ${open ? 'border-border-strong bg-surface-hover text-text' : 'border-border text-text-muted hover:border-border-strong hover:text-text'}`}
            >
                <Orbit size={15} strokeWidth={1.5} />
                <span className="hidden sm:inline">Visual</span>
                <span className="text-[11px] text-text-faint tabular-nums">
                    {index + 1}/{VISUALS.length}
                </span>
                <ChevronDown size={12} className={`hidden transition-transform motion-reduce:transition-none sm:block ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div
                    id={id}
                    className="absolute top-full -right-24 mt-3 max-h-[calc(100dvh-88px)] w-[min(380px,calc(100vw-40px))] overflow-y-auto rounded-2xl border border-border-strong bg-surface p-2 shadow-[0_20px_80px_#0009] sm:right-0"
                >
                    <fieldset>
                        <legend className="px-3 pt-2 pb-3 text-[13px] text-text-muted">Choose your view of Ruimte</legend>
                        {VISUALS.map((visual, i) => (
                            <label key={visual.id} className="relative flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-hover">
                                <input
                                    type="radio"
                                    name={id}
                                    value={visual.id}
                                    checked={selected === visual.id}
                                    onChange={() => select(visual.id)}
                                    className="peer sr-only"
                                />
                                <span
                                    className={`flex h-11 w-14 shrink-0 items-center justify-center rounded-lg ${selected === visual.id ? 'bg-accent/15 text-accent' : 'bg-bg text-text-faint'}`}
                                >
                                    <VisualGlyph id={visual.id} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2 text-[13px] font-medium text-text">
                                        {visual.name}
                                        {i >= 6 && <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-normal text-text-muted">New</span>}
                                    </span>
                                    <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">{visual.description}</span>
                                </span>
                                <span className="w-4 text-center text-[11px] text-text-faint tabular-nums">
                                    {selected === visual.id ? <Check size={14} className="text-accent" /> : i + 1}
                                </span>
                                <span className="pointer-events-none absolute inset-0 rounded-xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[-2px] peer-focus-visible:outline-accent" />
                            </label>
                        ))}
                    </fieldset>
                    <p className="mt-1 border-t border-border px-3 pt-3 pb-2 text-[11px] text-text-faint">Try a visual, then move your cursor over it.</p>
                </div>
            )}
        </div>
    );
}

function VisualGlyph({ id }: { readonly id: VisualId }) {
    return (
        <svg viewBox="0 0 48 36" className="h-9 w-12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
            {id === 'gravity' && (
                <>
                    <ellipse cx="24" cy="25" rx="20" ry="6" />
                    <ellipse cx="24" cy="24" rx="14" ry="9" />
                    <ellipse cx="24" cy="23" rx="7" ry="11" />
                    <path d="m24 3 4 7-4 6-4-6Z" fill="currentColor" />
                </>
            )}
            {id === 'garden' && (
                <>
                    <path d="M24 33V19m0 5L12 14 6 9m6 5 2-8m10 13L34 9l7-4M34 9l-3-6m-7 16L23 8l-6-5m6 5 5-5M24 28l14-10 4-7" />
                    <circle cx="6" cy="9" r="2" />
                    <circle cx="14" cy="6" r="2" />
                    <circle cx="41" cy="5" r="2" />
                    <circle cx="42" cy="11" r="2" />
                </>
            )}
            {id === 'warp' && (
                <>
                    {[1, 0.72, 0.46, 0.22].map((scale) => (
                        <path key={scale} d="M24 1 44 9v18L24 35 4 27V9Z" transform={`translate(${24 * (1 - scale)} ${18 * (1 - scale)}) scale(${scale})`} />
                    ))}
                </>
            )}
            {id === 'swarm' && (
                <>
                    <path d="M7 27C8 6 23 5 36 12M11 30c19 2 27-6 26-17M5 20c15 7 23-1 25-11" opacity=".5" />
                    <path d="m33 9 9 5-10 3 3-4Zm-23 14 7 7-10-1 5-2Zm15-17 8-3-2 9-2-5Z" fill="currentColor" />
                </>
            )}
            {id === 'aurora' && (
                <>
                    <path d="M12 3c29 3-15 27 13 30M20 3c29 3-15 27 13 30M28 3C0 6 43 30 15 33" strokeWidth="3" />
                    <path d="M12 3c29 3-15 27 13 30" stroke="white" strokeOpacity=".3" />
                </>
            )}
            {id === 'assembly' && (
                <>
                    <path d="m24 3 16 9v16l-16 8-16-8V12Z M8 12l16 8 16-8M24 20v16M16 8l16 8v16M32 8l-16 8v16M8 20l16 8 16-8" />
                </>
            )}
            {id === 'singularity' && (
                <>
                    <path d="M11 26C-1 7 30-2 39 13S17 42 10 23 28-1 36 11" strokeWidth="3" />
                    <ellipse cx="24" cy="18" rx="7" ry="4" transform="rotate(-35 24 18)" />
                    <circle cx="24" cy="18" r="1.5" fill="currentColor" />
                </>
            )}
            {id === 'silk' && (
                <>
                    <path d="M24 4C3 4 4 30 24 30S45 4 24 4Zm0 0C5 16 19 36 35 25S39-5 24 4Zm0 0C42 16 29 36 13 25S9-5 24 4Z" strokeWidth="2" />
                </>
            )}
            {id === 'bloom' && (
                <>
                    {Array.from({ length: 7 }, (_, i) => (
                        <path
                            key={i}
                            d="M24 15C10 1 32-2 35 9 32 3 26 8 25 15Z"
                            transform={`rotate(${(i * 360) / 7} 24 18)`}
                            fill="currentColor"
                            fillOpacity=".3"
                        />
                    ))}
                    <circle cx="24" cy="18" r="3" />
                </>
            )}
        </svg>
    );
}

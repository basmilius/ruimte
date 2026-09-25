'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedAnimations } from '../motion-preferences.ts';
import { VISUALS, type VisualId } from './catalog.ts';
import { garden, gravity, warp } from './fields.ts';
import { assembly, aurora, swarm } from './matter.ts';
import { Space, type Pointer, type Scene } from './space.ts';
import { createSculptureRenderer } from './sculpture-renderer.ts';
import { isSculpture, paintSculptureFallback, SCULPTURES, type SculptureId } from './sculptures.ts';
import { useHeroVisual } from './visual-state.ts';

const SCENES: Record<Exclude<VisualId, SculptureId>, Scene> = { gravity, garden, warp, swarm, aurora, assembly };

export function HeroVisual() {
    const { selected } = useHeroVisual();
    const reduced = useReducedAnimations();
    const [software, setSoftware] = useState(false);
    const canvas = useRef<HTMLCanvasElement>(null);
    const root = useRef<HTMLDivElement>(null);
    const pointer = useRef<Pointer>({ x: 0, y: 0, active: 0 });
    const visual = VISUALS.find((item) => item.id === selected)!;

    useEffect(() => {
        const element = canvas.current;
        const container = root.current;
        if (!element || !container) {
            return;
        }
        const color = getComputedStyle(element).getPropertyValue('--accent').trim();
        const blue = /^#[\da-f]{6}$/i.test(color) ? [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16)) : [21, 93, 252];
        let renderer: ReturnType<typeof createSculptureRenderer> = null;
        if (isSculpture(selected) && !software) {
            try {
                renderer = createSculptureRenderer(element, blue);
            } catch {
                const fallback = requestAnimationFrame(() => setSoftware(true));
                return () => cancelAnimationFrame(fallback);
            }
        }
        const ctx = renderer ? null : element.getContext('2d');
        if (!renderer && !ctx) {
            return;
        }
        const onContextLost = (event: Event) => {
            event.preventDefault();
            setSoftware(true);
        };
        element.addEventListener('webglcontextlost', onContextLost);
        const current: Pointer = { x: 0, y: 0, active: 0 };
        let frame = 0;
        let visible = true;
        let time = 6;
        let previous = 0;
        let elapsed = 0;

        const draw = () => {
            const opacity = reduced ? 1 : Math.min(1, elapsed / 0.45);
            if (renderer && isSculpture(selected)) {
                renderer.render(SCULPTURES[selected](time, current), current, opacity);
                return;
            }
            if (!ctx) {
                return;
            }
            ctx.clearRect(0, 0, 800, 800);
            ctx.save();
            ctx.globalAlpha = opacity;
            const space = new Space(ctx, current, blue, selected === 'swarm' ? 1.3 : selected === 'garden' ? 1.1 : 1);
            if (isSculpture(selected)) {
                paintSculptureFallback(space, SCULPTURES[selected](time, current));
            } else {
                SCENES[selected](space, time, current);
            }
            space.finish();
            ctx.restore();
        };
        const tick = (now: number) => {
            const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
            previous = now;
            time += delta;
            elapsed += delta;
            const ease = 1 - Math.exp(-delta * 6);
            current.x += (pointer.current.x - current.x) * ease;
            current.y += (pointer.current.y - current.y) * ease;
            current.active += (pointer.current.active - current.active) * ease;
            draw();
            frame = requestAnimationFrame(tick);
        };
        const sync = () => {
            cancelAnimationFrame(frame);
            previous = 0;
            if (reduced) {
                draw();
            } else if (visible && !document.hidden) {
                frame = requestAnimationFrame(tick);
            }
        };
        const resize = () => {
            const size = Math.round(element.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 2));
            element.width = size;
            element.height = size;
            ctx?.setTransform(size / 800, 0, 0, size / 800, 0, 0);
            if (reduced) {
                draw();
            }
        };
        const observer = new ResizeObserver(resize);
        observer.observe(element);
        const intersection = new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? false;
            sync();
        });
        intersection.observe(container);
        document.addEventListener('visibilitychange', sync);
        resize();
        sync();
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            intersection.disconnect();
            document.removeEventListener('visibilitychange', sync);
            element.removeEventListener('webglcontextlost', onContextLost);
            // React replays effects on the same canvas in development.
            renderer?.dispose(!element.isConnected);
        };
    }, [selected, reduced, software]);

    return (
        <div
            ref={root}
            className="group relative mx-auto mt-8 aspect-[1.12] w-full max-w-[540px] lg:mt-0"
            onPointerMove={(event) => {
                if (event.pointerType === 'touch' || reduced) {
                    return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                pointer.current = {
                    x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
                    y: ((event.clientY - bounds.top) / bounds.height) * 2 - 1,
                    active: 1
                };
            }}
            onPointerLeave={() => {
                pointer.current = { x: 0, y: 0, active: 0 };
            }}
        >
            <canvas
                key={`${selected}-${software}-${reduced}`}
                ref={canvas}
                aria-hidden="true"
                className="pointer-events-none absolute -top-[20%] -left-[25%] aspect-square w-[150%]"
            />
            <p className="sr-only">
                {visual.name}: {visual.description}. A three-dimensional animated illustration.
            </p>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 text-[11px] text-text-faint opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:hidden [@media(hover:none)]:hidden">
                <span className="h-1 w-1 rounded-full bg-accent" />
                {visual.hint}
            </div>
        </div>
    );
}

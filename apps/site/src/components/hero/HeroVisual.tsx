'use client';

import { useEffect, useRef } from 'react';
import { useReducedAnimations } from '../motion-preferences.ts';
import { createDelegation, DELEGATION_POSTER, DELEGATION_WIDTH, type Pointer } from './delegation.ts';

// The canvas is 150% of the container, moved up and left, so shadows and the faded edges may spill past it; in
// its 800 units the container starts here.
const BOX_LEFT = (0.25 / 1.5) * 800;
const BOX_TOP = (0.2 / 1.12 / 1.5) * 800;
const BOX_WIDTH = 800 / 1.5;
// The site's `--font-sans`, which is system faces only, so it is written here rather than read from the page.
const SANS = '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif';

export function HeroVisual() {
    const reduced = useReducedAnimations();
    const canvas = useRef<HTMLCanvasElement>(null);
    const root = useRef<HTMLDivElement>(null);
    const pointer = useRef<Pointer>({ x: 0, y: 0, active: 0 });

    useEffect(() => {
        const element = canvas.current;
        const container = root.current;
        const ctx = element?.getContext('2d');
        if (!element || !container || !ctx) {
            return;
        }
        const jetbrains = getComputedStyle(element).getPropertyValue('--font-jetbrains').trim();
        const mono = `${jetbrains ? `${jetbrains}, ` : ''}ui-monospace, monospace`;
        const delegation = createDelegation(ctx, { sans: SANS, mono });
        let frame = 0;
        let visible = true;
        let time = 0;
        let previous = 0;

        const draw = () => {
            ctx.clearRect(0, 0, 800, 800);
            ctx.save();
            ctx.translate(BOX_LEFT, BOX_TOP);
            ctx.scale(BOX_WIDTH / DELEGATION_WIDTH, BOX_WIDTH / DELEGATION_WIDTH);
            delegation.draw(reduced ? DELEGATION_POSTER : time);
            ctx.restore();
            const opacity = reduced ? 1 : Math.min(1, time / 0.45);
            if (opacity < 1) {
                // The take sets its own alpha all the way through, so the fade in is laid over the finished frame.
                ctx.save();
                ctx.globalCompositeOperation = 'destination-in';
                ctx.fillStyle = `rgba(0,0,0,${opacity})`;
                ctx.fillRect(0, 0, 800, 800);
                ctx.restore();
            }
        };
        const tick = (now: number) => {
            const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
            previous = now;
            time += delta;
            delegation.update(time, delta, pointer.current);
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
            ctx.setTransform(size / 800, 0, 0, size / 800, 0, 0);
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
        };
    }, [reduced]);

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
                // The take eases the pointer back to the middle from where it left.
                pointer.current = { ...pointer.current, active: 0 };
            }}
        >
            <canvas
                key={String(reduced)}
                ref={canvas}
                aria-hidden="true"
                className="pointer-events-none absolute -top-[20%] -left-[25%] aspect-square w-[150%]"
            />
            <p className="sr-only">
                Give the task to a team, get one answer back: a lead agent starts three agents on a slow checkout, their results come back to it as they finish,
                and it writes one answer.
            </p>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 text-[11px] text-text-faint opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:hidden [@media(hover:none)]:hidden">
                <span className="h-1 w-1 rounded-full bg-accent" />
                Point at an agent to bring it forward
            </div>
        </div>
    );
}

'use client';

import { useEffect, useRef } from 'react';
import { useStagePlayback } from './film/playback.ts';

const COLUMNS = 100;
const ROWS = 36;
const WIDTH = 760;
const HEIGHT = 720;

function project(u: number, v: number, time: number) {
    const twist = u * 5.8 - 1.7 + Math.sin(time * 0.16) * 0.45;
    const spread = 100 + Math.sin(u * Math.PI) * 65;
    const x = (u - 0.5) * 650;
    const y = Math.cos(twist) * v * spread;
    const z = Math.sin(twist) * v * spread;
    const perspective = 700 / (700 - z);
    const tilt = -0.72;
    return {
        x: WIDTH / 2 + (x * Math.cos(tilt) - y * Math.sin(tilt)) * perspective,
        y: 430 + (x * Math.sin(tilt) + y * Math.cos(tilt)) * perspective,
        depth: (z + 170) / 340,
        scale: perspective
    };
}

export function NeuralField() {
    const ref = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const elapsed = useRef(3);
    const { playing, still } = useStagePlayback(ref);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) {
            return;
        }

        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        let frame = 0;
        let previous = 0;

        function draw() {
            if (!canvas || !context) {
                return;
            }
            context.clearRect(0, 0, WIDTH, HEIGHT);
            const time = still ? 3 : elapsed.current;

            for (let row = 0; row < ROWS; row++) {
                const v = (row / (ROWS - 1)) * 2 - 1;
                const points = Array.from({ length: COLUMNS }, (_, column) => project(column / (COLUMNS - 1), v, time));

                if (row % 3 === 0) {
                    context.beginPath();
                    points.forEach((point, i) => (i === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
                    context.strokeStyle = accent;
                    context.globalAlpha = 0.12;
                    context.lineWidth = 0.6;
                    context.stroke();
                }

                points.forEach((point, column) => {
                    const u = column / (COLUMNS - 1);
                    const edge = Math.sin(u * Math.PI) ** 0.5;
                    const wave = Math.max(0, Math.sin(u * 10 - time * 0.7 + v * 2)) ** 18;
                    const light = wave * (0.35 + point.depth * 0.65);
                    context.globalAlpha = edge * (0.2 + point.depth * 0.55 + light * 0.25);
                    context.fillStyle = accent;
                    context.beginPath();
                    context.arc(point.x, point.y, (0.65 + point.depth * 0.7 + light * 0.5) * point.scale, 0, Math.PI * 2);
                    context.fill();

                    if (light > 0.35) {
                        context.globalAlpha = light * edge * 0.7;
                        context.fillStyle = '#ffffff';
                        context.beginPath();
                        context.arc(point.x, point.y, 0.7 * point.scale, 0, Math.PI * 2);
                        context.fill();
                    }
                });
            }
            context.globalAlpha = 1;
        }

        function resize() {
            if (!canvas || !context) {
                return;
            }
            const density = Math.min(window.devicePixelRatio, 2);
            canvas.width = Math.round(canvas.clientWidth * density);
            canvas.height = Math.round(canvas.clientHeight * density);
            context.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
            draw();
        }

        function tick(now: number) {
            if (previous && !document.hidden) {
                elapsed.current += Math.min((now - previous) / 1000, 0.05);
            }
            previous = now;
            if (!document.hidden) {
                draw();
            }
            frame = requestAnimationFrame(tick);
        }

        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();
        if (playing) {
            frame = requestAnimationFrame(tick);
        }
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [playing, still]);

    return (
        <div ref={ref} aria-hidden className="pointer-events-none relative mx-auto aspect-[560/460] w-full max-w-[560px]">
            <canvas ref={canvasRef} className="absolute -top-[12%] -left-[20%] h-[160%] w-[140%]" />
        </div>
    );
}

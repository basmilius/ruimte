import type { RefObject } from 'react';
import type { LiveStreamFrame } from '@ruimte/contracts';

/* Waits out `ms`, or gives up at once when whoever is waiting was called off. */
export const wait = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        const timer = window.setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                window.clearTimeout(timer);
                resolve();
            },
            { once: true }
        );
    });

/* The canvas a stream is painted on and what the surface around it is told about a frame. */
export interface PaintTarget {
    canvas: RefObject<HTMLCanvasElement | null>;
    painted(): void;
    failed(message: string): void;
    /* What to say about a frame that threw something that was not an `Error`. */
    undrawable(): string;
}

/* A format the painter cannot draw itself, such as a video codec behind `VideoDecoder`. */
export interface FrameDecoder {
    handles(frame: LiveStreamFrame): boolean;
    decode(frame: LiveStreamFrame): void;
    close(): void;
}

/*
 * The latest frame of a live stream on a canvas. One frame is drawn at a time and only the newest
 * one waits, so a slow decode drops what it was overtaken by rather than falling further behind.
 */
export class FramePainter {
    private readonly target: PaintTarget;
    private readonly decoder: FrameDecoder | null;
    private drawing = false;
    private pending: LiveStreamFrame | null = null;

    constructor(target: PaintTarget, decoder?: (target: PaintTarget) => FrameDecoder) {
        this.target = target;
        this.decoder = decoder === undefined ? null : decoder(target);
    }

    push(frame: LiveStreamFrame): void {
        if (this.decoder !== null && this.decoder.handles(frame)) {
            this.decoder.decode(frame);
            return;
        }
        this.pending = frame;
        if (!this.drawing) {
            void this.draw();
        }
    }

    close(): void {
        this.pending = null;
        this.decoder?.close();
    }

    private async draw(): Promise<void> {
        this.drawing = true;
        try {
            while (this.pending) {
                const frame = this.pending;
                this.pending = null;
                const bitmap = await createImageBitmap(new Blob([frame.data.slice().buffer], { type: 'image/jpeg' }));
                const canvas = this.target.canvas.current;
                if (canvas) {
                    canvas.width = frame.width;
                    canvas.height = frame.height;
                    canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0, frame.width, frame.height);
                    this.target.painted();
                }
                bitmap.close();
            }
        } catch (error) {
            this.target.failed(error instanceof Error ? error.message : this.target.undrawable());
        } finally {
            this.drawing = false;
            if (this.pending) {
                void this.draw();
            }
        }
    }
}

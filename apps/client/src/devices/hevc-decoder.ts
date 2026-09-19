import i18next from 'i18next';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { hevcKeyFrame } from '@/devices/device-layout';
import type { FrameDecoder, PaintTarget } from '@/transport/live-stream';

export class HevcDecoderGate {
    private awaitingKeyFrame = true;

    accept(data: Uint8Array, decodeQueueSize: number): EncodedVideoChunkType | null {
        const keyFrame = hevcKeyFrame(data);
        if (this.awaitingKeyFrame && !keyFrame) {
            return null;
        }
        if (decodeQueueSize > 8 && !keyFrame) {
            return null;
        }
        this.awaitingKeyFrame = false;
        return keyFrame ? 'key' : 'delta';
    }

    reset(): void {
        this.awaitingKeyFrame = true;
    }
}

/* The Annex-B HEVC a device sends over the helper pipe, through `VideoDecoder` onto the same canvas. */
class HevcFrameDecoder implements FrameDecoder {
    private readonly target: PaintTarget;
    private readonly gate = new HevcDecoderGate();
    private decoder: VideoDecoder | null = null;

    constructor(target: PaintTarget) {
        this.target = target;
    }

    handles(frame: LiveStreamFrame): boolean {
        return frame.format === 'hevc';
    }

    close(): void {
        this.decoder?.close();
        this.decoder = null;
        this.gate.reset();
    }

    decode(frame: LiveStreamFrame): void {
        if (!('VideoDecoder' in window)) {
            this.target.failed(i18next.t('machines:device.stream.noDecoder'));
            return;
        }
        const chunkType = this.gate.accept(frame.data, this.decoder?.decodeQueueSize ?? 0);
        if (!chunkType) {
            return;
        }
        try {
            if (!this.decoder || this.decoder.state === 'closed') {
                this.decoder = this.open();
            }
            this.decoder.decode(new EncodedVideoChunk({ type: chunkType, timestamp: frame.sequence * 16_667, data: frame.data.slice().buffer }));
        } catch (error) {
            if (this.decoder?.state !== 'closed') {
                this.decoder?.close();
            }
            this.gate.reset();
            this.decoder = null;
            this.target.failed(error instanceof Error ? error.message : i18next.t('machines:device.stream.undecodable'));
        }
    }

    private open(): VideoDecoder {
        const decoder = new VideoDecoder({
            output: (videoFrame) => {
                const canvas = this.target.canvas.current;
                if (canvas) {
                    canvas.width = videoFrame.displayWidth;
                    canvas.height = videoFrame.displayHeight;
                    canvas.getContext('2d', { alpha: false })?.drawImage(videoFrame, 0, 0, canvas.width, canvas.height);
                    this.target.painted();
                }
                videoFrame.close();
            },
            error: (error) => {
                if (this.decoder === decoder) {
                    this.decoder = null;
                    this.gate.reset();
                }
                this.target.failed(error.message);
            }
        });
        decoder.configure({ codec: 'hev1.1.6.L93.B0', hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true });
        return decoder;
    }
}

export const hevcFrameDecoder = (target: PaintTarget): FrameDecoder => new HevcFrameDecoder(target);

import i18next from 'i18next';
import { annexBNalHeaders, H264_SPS, h264KeyFrame, hevcKeyFrame, type LiveStreamFormat, type LiveStreamFrame } from '@ruimte/contracts';
import type { FrameDecoder, PaintTarget } from '@/transport/live-stream';

type VideoFormat = Exclude<LiveStreamFormat, 'jpeg'>;

interface VideoCodec {
    keyFrame(data: Uint8Array): boolean;
    /* What `VideoDecoder.configure` is told for a key frame, or null when the frame does not say. */
    codecString(data: Uint8Array): string | null;
}

/* `avc1.PPCCLL` from the profile, constraint flags and level that open the sequence parameter set (RFC 6381). */
export const h264CodecString = (data: Uint8Array): string | null => {
    const sps = annexBNalHeaders(data).find((header) => (data[header]! & 0x1f) === H264_SPS && header + 3 < data.byteLength);
    if (sps === undefined) {
        return null;
    }
    const hex = [...data.subarray(sps + 1, sps + 4)].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join('');
    return `avc1.${hex}`;
};

const CODECS: Record<VideoFormat, VideoCodec> = {
    hevc: { keyFrame: hevcKeyFrame, codecString: () => 'hev1.1.6.L93.B0' },
    h264: { keyFrame: h264KeyFrame, codecString: h264CodecString }
};

const isVideoFormat = (format: LiveStreamFormat | undefined): format is VideoFormat => format !== undefined && format in CODECS;

export class VideoDecoderGate {
    private awaitingKeyFrame = true;
    private lastSequence: number | null = null;

    accept(keyFrame: boolean, decodeQueueSize: number, sequence: number): EncodedVideoChunkType | null {
        // A machine behind on its link skips to the next key frame; a delta frame after a gap lacks what it refers to.
        const gap = this.lastSequence !== null && sequence !== (this.lastSequence + 1) >>> 0;
        this.lastSequence = sequence;
        if (gap && !keyFrame) {
            this.awaitingKeyFrame = true;
        }
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
        this.lastSequence = null;
    }
}

/*
 * The Annex-B video a device sends, through `VideoDecoder` onto the same canvas. A change of format
 * or frame size starts over at the next key frame, since a rotated device restarts its encoder with
 * a new parameter set that the old configuration cannot read.
 */
class VideoFrameDecoder implements FrameDecoder {
    private readonly target: PaintTarget;
    private readonly gate = new VideoDecoderGate();
    private decoder: VideoDecoder | null = null;
    private configured: string | null = null;
    private format: VideoFormat | null = null;
    private size: { width: number; height: number } | null = null;

    constructor(target: PaintTarget) {
        this.target = target;
    }

    handles(frame: LiveStreamFrame): boolean {
        return isVideoFormat(frame.format);
    }

    close(): void {
        this.drop();
        this.gate.reset();
        this.format = null;
        this.size = null;
    }

    decode(frame: LiveStreamFrame): void {
        if (!isVideoFormat(frame.format)) {
            return;
        }
        if (!('VideoDecoder' in window)) {
            this.target.failed(i18next.t('machines:device.stream.noDecoder'));
            return;
        }
        if (frame.format !== this.format || frame.width !== this.size?.width || frame.height !== this.size.height) {
            this.close();
            this.format = frame.format;
            this.size = { width: frame.width, height: frame.height };
        }
        const codec = CODECS[frame.format];
        const keyFrame = codec.keyFrame(frame.data);
        const chunkType = this.gate.accept(keyFrame, this.decoder?.decodeQueueSize ?? 0, frame.sequence);
        if (!chunkType) {
            return;
        }
        try {
            const codecString = keyFrame ? codec.codecString(frame.data) : null;
            if (codecString !== null && codecString !== this.configured) {
                this.drop();
            }
            if (!this.decoder || this.decoder.state === 'closed') {
                if (codecString === null) {
                    this.gate.reset();
                    return;
                }
                this.decoder = this.open(codecString);
            }
            this.decoder.decode(new EncodedVideoChunk({ type: chunkType, timestamp: frame.sequence * 16_667, data: frame.data.slice().buffer }));
        } catch (error) {
            this.drop();
            this.gate.reset();
            this.target.failed(error instanceof Error ? error.message : i18next.t('machines:device.stream.undecodable'));
        }
    }

    private drop(): void {
        if (this.decoder && this.decoder.state !== 'closed') {
            this.decoder.close();
        }
        this.decoder = null;
        this.configured = null;
    }

    private open(codec: string): VideoDecoder {
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
                    this.configured = null;
                    this.gate.reset();
                }
                this.target.failed(error.message);
            }
        });
        decoder.configure({ codec, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true });
        this.configured = codec;
        return decoder;
    }
}

export const videoFrameDecoder = (target: PaintTarget): FrameDecoder => new VideoFrameDecoder(target);

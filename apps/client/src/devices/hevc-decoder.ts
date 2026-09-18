import { hevcKeyFrame } from '@/devices/device-layout';

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

export const LIVE_STREAM_CONTENT_TYPE = 'application/x-ruimte-jpeg-stream; version=1';
export const HEVC_STREAM_CONTENT_TYPE = 'application/x-ruimte-hevc-stream; version=1';
export const LIVE_STREAM_MAGIC = new Uint8Array([0x52, 0x53, 0x54, 0x4d, 0x01, 0x00, 0x00, 0x00]);
export const LIVE_STREAM_FRAME_HEADER_BYTES = 12;
export const LIVE_STREAM_MAX_FRAME_BYTES = 8 * 1024 * 1024;

export interface LiveStreamFrame {
    sequence: number;
    width: number;
    height: number;
    data: Uint8Array;
    format?: 'jpeg' | 'hevc';
}

export const encodeLiveStreamFrame = (frame: LiveStreamFrame): Uint8Array => {
    if (frame.data.byteLength > LIVE_STREAM_MAX_FRAME_BYTES) {
        throw new Error('Live stream frame is too large');
    }
    if (!Number.isInteger(frame.sequence) || frame.sequence < 0 || frame.sequence > 0xffffffff) {
        throw new Error('Live stream sequence is outside uint32');
    }
    if (
        !Number.isInteger(frame.width) ||
        !Number.isInteger(frame.height) ||
        frame.width < 1 ||
        frame.height < 1 ||
        frame.width > 0xffff ||
        frame.height > 0xffff
    ) {
        throw new Error('Live stream dimensions are outside uint16');
    }
    const encoded = new Uint8Array(LIVE_STREAM_FRAME_HEADER_BYTES + frame.data.byteLength);
    const header = new DataView(encoded.buffer);
    header.setUint32(0, frame.data.byteLength);
    header.setUint32(4, frame.sequence);
    header.setUint16(8, frame.width);
    header.setUint16(10, frame.height);
    encoded.set(frame.data, LIVE_STREAM_FRAME_HEADER_BYTES);
    return encoded;
};

export class LiveStreamDecoder {
    private buffer = new Uint8Array();
    private preambleRead = false;

    push(chunk: Uint8Array): LiveStreamFrame[] {
        const joined = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
        joined.set(this.buffer);
        joined.set(chunk, this.buffer.byteLength);
        this.buffer = joined;

        if (!this.preambleRead) {
            if (this.buffer.byteLength < LIVE_STREAM_MAGIC.byteLength) {
                return [];
            }
            for (let index = 0; index < LIVE_STREAM_MAGIC.byteLength; index += 1) {
                if (this.buffer[index] !== LIVE_STREAM_MAGIC[index]) {
                    throw new Error('Unknown live stream format');
                }
            }
            this.buffer = this.buffer.slice(LIVE_STREAM_MAGIC.byteLength);
            this.preambleRead = true;
        }

        const frames: LiveStreamFrame[] = [];
        while (this.buffer.byteLength >= LIVE_STREAM_FRAME_HEADER_BYTES) {
            const header = new DataView(this.buffer.buffer, this.buffer.byteOffset, LIVE_STREAM_FRAME_HEADER_BYTES);
            const length = header.getUint32(0);
            if (length > LIVE_STREAM_MAX_FRAME_BYTES) {
                throw new Error('Live stream frame is too large');
            }
            const total = LIVE_STREAM_FRAME_HEADER_BYTES + length;
            if (this.buffer.byteLength < total) {
                break;
            }
            frames.push({
                sequence: header.getUint32(4),
                width: header.getUint16(8),
                height: header.getUint16(10),
                data: this.buffer.slice(LIVE_STREAM_FRAME_HEADER_BYTES, total)
            });
            this.buffer = this.buffer.slice(total);
        }
        return frames;
    }
}

/*
 * Reads the bytes of one HTTP/1.1 response, for the listener-free variant that has to turn a stream of the
 * machine back into a `Response`. The request asks for `Connection: close`, so a body without a length ends
 * where the stream does.
 */
export interface ResponseHead {
    status: number;
    statusText: string;
    headers: Array<[string, string]>;
}

type Body = 'head' | 'length' | 'chunk-size' | 'chunk-data' | 'chunk-end' | 'trailers' | 'until-close' | 'done';

export class ResponseDecoder {
    private buffer: Buffer = Buffer.alloc(0);
    private mode: Body = 'head';
    private remaining = 0;
    private readonly onHead: (head: ResponseHead) => void;
    private readonly onBody: (bytes: Buffer) => void;
    private readonly onDone: () => void;

    constructor(onHead: (head: ResponseHead) => void, onBody: (bytes: Buffer) => void, onDone: () => void) {
        this.onHead = onHead;
        this.onBody = onBody;
        this.onDone = onDone;
    }

    feed(chunk: Uint8Array): void {
        this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);

        while (this.step()) {}
    }

    /* The stream ended: a body that reads until then is complete. */
    end(): void {
        if (this.mode === 'until-close') {
            this.finish();
        }
    }

    private finish(): void {
        if (this.mode !== 'done') {
            this.mode = 'done';
            this.onDone();
        }
    }

    private step(): boolean {
        switch (this.mode) {
            case 'head': {
                const end = this.buffer.indexOf('\r\n\r\n');

                if (end === -1) {
                    return false;
                }

                const [statusLine, ...lines] = this.buffer.subarray(0, end).toString('latin1').split('\r\n');
                const match = /^HTTP\/1\.[01] (\d{3}) ?(.*)$/.exec(statusLine!);

                this.buffer = this.buffer.subarray(end + 4);

                if (match === null) {
                    throw new Error('The answer is not HTTP');
                }

                const headers = lines.map((line): [string, string] => {
                    const colon = line.indexOf(':');

                    return [line.slice(0, colon), line.slice(colon + 1).trim()];
                });
                const find = (name: string): string | undefined => headers.find(([key]) => key.toLowerCase() === name)?.[1];
                const status = Number(match[1]);

                this.onHead({
                    status,
                    statusText: match[2]!,
                    headers: headers.filter(([key]) => !['transfer-encoding', 'connection', 'keep-alive'].includes(key.toLowerCase()))
                });

                if (status === 204 || status === 304 || (status >= 100 && status < 200)) {
                    this.finish();

                    return false;
                }

                if (find('transfer-encoding')?.toLowerCase() === 'chunked') {
                    this.mode = 'chunk-size';
                } else if (find('content-length') !== undefined) {
                    this.remaining = Number(find('content-length'));
                    this.mode = this.remaining === 0 ? 'done' : 'length';

                    if (this.remaining === 0) {
                        this.onDone();
                    }
                } else {
                    this.mode = 'until-close';
                }

                return true;
            }
            case 'length': {
                const take = Math.min(this.remaining, this.buffer.length);

                if (take === 0) {
                    return false;
                }

                this.onBody(this.buffer.subarray(0, take));
                this.buffer = this.buffer.subarray(take);
                this.remaining -= take;

                if (this.remaining === 0) {
                    this.finish();
                }

                return this.buffer.length > 0;
            }
            case 'until-close': {
                if (this.buffer.length === 0) {
                    return false;
                }

                this.onBody(this.buffer);
                this.buffer = Buffer.alloc(0);

                return false;
            }
            case 'chunk-size': {
                const end = this.buffer.indexOf('\r\n');

                if (end === -1) {
                    return false;
                }

                this.remaining = parseInt(this.buffer.subarray(0, end).toString('latin1').split(';')[0]!, 16);
                this.buffer = this.buffer.subarray(end + 2);
                this.mode = this.remaining === 0 ? 'trailers' : 'chunk-data';

                return true;
            }
            case 'chunk-data': {
                const take = Math.min(this.remaining, this.buffer.length);

                if (take === 0) {
                    return false;
                }

                this.onBody(this.buffer.subarray(0, take));
                this.buffer = this.buffer.subarray(take);
                this.remaining -= take;

                if (this.remaining === 0) {
                    this.mode = 'chunk-end';
                }

                return true;
            }
            case 'chunk-end': {
                if (this.buffer.length < 2) {
                    return false;
                }

                this.buffer = this.buffer.subarray(2);
                this.mode = 'chunk-size';

                return true;
            }
            case 'trailers': {
                const end = this.buffer.indexOf('\r\n');

                if (end === -1) {
                    return false;
                }

                const empty = end === 0;

                this.buffer = this.buffer.subarray(end + 2);

                if (empty) {
                    this.finish();

                    return false;
                }

                return true;
            }
            default:
                return false;
        }
    }
}

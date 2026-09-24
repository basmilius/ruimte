export interface DictationChunk {
    // A complete snapshot, including punctuation. Never append streaming token fragments.
    text: string;
    final: boolean;
}

/* Each code is a key under `voice:dictation.errors`, so a person never reads the code itself. */
export type DictationErrorCode = 'noBridge' | 'overrun' | 'recognition' | 'targetChanged';

export class DictationError extends Error {
    readonly code: DictationErrorCode;
    constructor(code: DictationErrorCode, message?: string) {
        super(message ?? code);
        this.name = 'DictationError';
        this.code = code;
    }
}

export interface DictationOptions {
    language: string;
    deviceId?: string;
}

export interface DictationHandlers {
    onReady?(): void;
    onChunk(chunk: DictationChunk): void;
    onError(error: Error): void;
    onEnd(): void;
    onBands?(bands: number[]): void;
}

export interface DictationSession {
    stop(): void;
    cancel(): void;
}

export interface DictationEngine {
    start(options: DictationOptions, handlers: DictationHandlers): DictationSession;
}

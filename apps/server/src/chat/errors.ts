type ChatErrorCode =
    | 'history-expired'
    | 'chat-not-found'
    | 'chat-busy'
    | 'request-not-found'
    | 'chat-unsupported'
    | 'subagent-not-found'
    // What a fork is refused with.
    | 'turn-not-found'
    | 'turn-running'
    | 'provider-not-installed'
    | 'transcript-missing'
    | 'transcript-format'
    | 'fork-failed'
    | 'not-on-a-canvas'
    | 'canvas-full';

export class ChatError extends Error {
    readonly code: ChatErrorCode;

    constructor(code: ChatErrorCode, message: string) {
        super(message);
        this.name = 'ChatError';
        this.code = code;
    }
}

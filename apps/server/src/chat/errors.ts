type ChatErrorCode = 'history-expired' | 'chat-not-found' | 'chat-busy' | 'request-not-found' | 'chat-unsupported';

export class ChatError extends Error {
    readonly code: ChatErrorCode;

    constructor(code: ChatErrorCode, message: string) {
        super(message);
        this.name = 'ChatError';
        this.code = code;
    }
}

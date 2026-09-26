import { CodedError } from '../coded-error.ts';

export type ChatErrorCode =
    | 'history-expired'
    | 'chat-not-found'
    | 'chat-busy'
    | 'request-not-found'
    | 'chat-unsupported'
    | 'invalid-attachments'
    | 'subagent-not-found'
    | 'task-not-found'
    // What reading a CLI's own conversation is refused with.
    | 'transcript-missing'
    | 'transcript-format'
    | 'fork-failed'
    // What a bookmark is refused with.
    | 'item-not-found'
    | 'bookmark-not-found'
    | 'too-many-bookmarks';

/* A host that refuses more than a chat does widens the codes with its own. */
export class ChatError<TCode extends string = ChatErrorCode> extends CodedError<TCode> {}

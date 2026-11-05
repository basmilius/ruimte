import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

export function scratchFolderOf(home: string): string {
    return join(resolve(home), 'scratch');
}

export function newChatId(): string {
    return `chat-${randomBytes(6).toString('hex')}`;
}

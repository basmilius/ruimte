import type { ChatAttachment } from '@ruimte/contracts';

interface UserMessageInput {
    text: string;
    attachments?: ChatAttachment[];
    // Written before the text, for what the CLI has no flag for (`ultrathink`).
    prefix?: string;
}

/*
 * The `user` frame the CLI reads on stdin. The message body is the Anthropic API shape: a
 * content array of text and image blocks, which the CLI passes through unchanged (checked
 * against claude 2.1.266). An image-only message carries no empty text block.
 */
export const buildUserMessage = ({ text, attachments = [], prefix = '' }: UserMessageInput): Record<string, unknown> => {
    const content: unknown[] = [];
    const prompt = `${prefix}${text}`;
    if (prompt.trim() !== '') {
        content.push({ type: 'text', text: prompt });
    }
    for (const attachment of attachments) {
        content.push({ type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data } });
    }
    return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' };
};

import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CodedError } from '@adecore/agents';
import type { AttachmentStore } from '@adecore/agents/chat';
import { KeyedSerializer } from '@adecore/utils/async';
import type { ChatAttachment } from '@ruimte/contracts';
import { withoutControlCharacters } from '../bytes/byte-route.ts';
import { AGENT_ATTACHMENT_TYPES } from './attachment-type.ts';

/* What an agent may put in its chat, images and models together; the folder goes with a clear or a deletion of the chat, so nothing here keeps an index. */
export const AGENT_ATTACHMENT_LIMIT = 64;

const ID = /^agent-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

// Room the name leaves in a file name: 255 bytes less the id, the separator and the extension.
const NAME_ENCODED_MAX = 160;

const MIME_OF: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(AGENT_ATTACHMENT_TYPES).map(([mime, extension]) => [extension, mime]));

/* The longest name that still fits a file name once encoded, cut at a whole character. */
function fittingName(name: string): string {
    let fitting = Array.from(withoutControlCharacters(name).trim());
    while (fitting.length > 0 && encodeURIComponent(fitting.join('')).length > NAME_ENCODED_MAX) {
        fitting = fitting.slice(0, -1);
    }
    return fitting.join('') || 'attachment';
}

/* The id, the name (absent when the file carries none) and the extension of a file of the folder, or null when it is no agent attachment. */
function parsed(file: string): { id: string; name: string | null; extension: string } | null {
    const dot = file.lastIndexOf('.');
    const extension = file.slice(dot + 1);
    const stem = file.slice(0, Math.max(dot, 0));
    const separator = stem.indexOf('~');
    const id = separator === -1 ? stem : stem.slice(0, separator);
    if (!ID.test(id) || MIME_OF[extension] === undefined) {
        return null;
    }
    try {
        return { id, name: separator === -1 ? null : decodeURIComponent(stem.slice(separator + 1)), extension };
    } catch {
        return { id, name: null, extension };
    }
}

/*
 * The images and models an agent attached to its own chat, as `agent-<uuid>~<name>.<ext>` in the chat's attachment
 * folder, the name URI-encoded after the id. The id is what a lookup reads, so an unrelated attachment is
 * never touched and there is no index to keep.
 */
export class AgentImages {
    private readonly attachments: Pick<AttachmentStore, 'folderOf'>;
    // One save of a chat at a time, so parallel attaches count the folder one after the other and cannot pass the limit together.
    private readonly saves = new KeyedSerializer();

    constructor(attachments: Pick<AttachmentStore, 'folderOf'>) {
        this.attachments = attachments;
    }

    /* Stores bytes whose type and size the caller already checked against `agentAttachmentType`; refuses past the per-chat limit. */
    save(chatId: string, upload: { name: string; mime: string; bytes: Uint8Array }): Promise<ChatAttachment> {
        return this.saves.run(chatId, () => this.store(chatId, upload));
    }

    private async store(chatId: string, upload: { name: string; mime: string; bytes: Uint8Array }): Promise<ChatAttachment> {
        const extension = AGENT_ATTACHMENT_TYPES[upload.mime];
        if (extension === undefined) {
            throw new CodedError('attach-not-image', `${upload.mime} is not an image or model type a chat can show`);
        }
        const folder = this.attachments.folderOf(chatId);
        if ((await this.names(folder)).length >= AGENT_ATTACHMENT_LIMIT) {
            throw new CodedError(
                'attach-limit',
                `This chat already holds ${AGENT_ATTACHMENT_LIMIT} images and models you attached; show one of those again instead`
            );
        }
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const id = `agent-${randomUUID()}`;
        const name = fittingName(upload.name);
        const path = join(folder, `${id}~${encodeURIComponent(name)}.${extension}`);
        await writeFile(path, upload.bytes, { mode: 0o600 });
        return { id, name, mime: upload.mime, size: upload.bytes.byteLength, path };
    }

    /* The file behind an id, or null when the id is no agent attachment of this chat. */
    async find(chatId: string, id: string): Promise<ChatAttachment | null> {
        if (!ID.test(id)) {
            return null;
        }
        const folder = this.attachments.folderOf(chatId);
        for (const file of await this.names(folder)) {
            if (parsed(file)?.id !== id) {
                continue;
            }
            const path = join(folder, file);
            // A link in the folder could point anywhere, so only a regular file of its own counts.
            const info = await lstat(path).catch(() => null);
            if (info?.isFile()) {
                const { name, extension } = parsed(file)!;
                return { id, name: name ?? `${id}.${extension}`, mime: MIME_OF[extension]!, size: info.size, path };
            }
        }
        return null;
    }

    /* Gives a fork the same files under the same ids, so the blocks it copied still show them. */
    async copy(fromChatId: string, toChatId: string): Promise<void> {
        const source = this.attachments.folderOf(fromChatId);
        const found = await this.names(source);
        const regular = await Promise.all(found.map(async (name) => ((await lstat(join(source, name)).catch(() => null))?.isFile() ? name : null)));
        const names = regular.filter((name): name is string => name !== null);
        if (names.length === 0) {
            return;
        }
        const target = this.attachments.folderOf(toChatId);
        await mkdir(target, { recursive: true, mode: 0o700 });
        await Promise.all(names.map((name) => copyFile(join(source, name), join(target, name))));
    }

    private async names(folder: string): Promise<string[]> {
        const entries = await readdir(folder).catch(() => []);
        return entries.filter((file) => parsed(file) !== null);
    }
}

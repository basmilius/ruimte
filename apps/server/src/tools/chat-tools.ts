import { basename } from 'node:path';
import { z } from 'zod';
import { ToolRefusal } from '@adecore/agents/context';
import { AGENT_IMAGE_BYTES, AGENT_MODEL_BYTES, AGENT_MODEL_TYPES, agentAttachmentBytes, agentAttachmentType } from '../chat/attachment-type.ts';
import type { AgentFiles } from '../mcp/files.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineToolkit } from './tool.ts';
import { field } from './host.ts';

const MIB = 1024 * 1024;

const NEEDS_PATH = 'chat_attach needs path, an image or model file of your own';

export interface AgentAttachment {
    name: string;
    /* The bytes, base64. */
    data: string;
}

/* An image or a model file of the caller's own as `chat.attach` takes it, refused when it is neither or too large. */
export async function attachmentOf(files: AgentFiles, path: string, name: string | undefined): Promise<AgentAttachment> {
    const buffer = Buffer.alloc(AGENT_MODEL_BYTES + 1);
    const length = await files.read(path, buffer);

    if (length > AGENT_MODEL_BYTES) {
        throw new ToolRefusal(
            'attach-too-large',
            `${path} is more than the ${AGENT_MODEL_BYTES / MIB} MiB a model may be, and an image ${AGENT_IMAGE_BYTES / MIB} MiB`
        );
    }

    const bytes = buffer.subarray(0, length);
    const type = agentAttachmentType(bytes);

    if (type === null) {
        throw new ToolRefusal(
            'attach-not-image',
            `${path} is no image or model: its bytes are not a PNG, JPEG, GIF, WebP, HEIC or HEIF, nor a binary glTF, USDZ or STL`
        );
    }

    if (length > agentAttachmentBytes(type.kind)) {
        throw new ToolRefusal('attach-too-large', `${path} is more than the ${AGENT_IMAGE_BYTES / MIB} MiB an image may be`);
    }

    return { name: name ?? basename(path), data: bytes.toString('base64') };
}

const chatAttach = defineActionTool('chat', {
    name: 'chat_attach',
    action: 'chat.attach',
    description: 'Attaches an image or 3D model to this chat, for Image, Gallery, Compare and Model.',
    audience: 'chat',
    input: z.object({
        name: z.string({ error: 'name needs a file name' }).trim().min(1, 'name needs a file name, or leave it out to take the one of path').optional(),
        path: z.string({ error: NEEDS_PATH }).min(1, NEEDS_PATH)
    }),
    async run(input, call) {
        const read = await attachmentOf(await call.files(), input.path, input.name);
        const { attachment } = await runAction(call, 'chat.attach', read);

        return [
            `attachment\t${attachment.id}\t${field(attachment.name)}\t${attachment.mime}\t${attachment.size}`,
            AGENT_MODEL_TYPES[attachment.mime] === undefined
                ? `next\tShow it with <Image attachment="${attachment.id}" alt="..."/> in a ruimte-ui block`
                : `next\tShow it with <Model attachment="${attachment.id}">caption</Model> in a ruimte-ui block once the person asks to see it`
        ];
    }
});

export const chatToolkit = defineToolkit('chat', [chatAttach]);

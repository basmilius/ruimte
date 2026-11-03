import type { ActionHandlers } from '@ruimte/actions';
import {
    AGENT_IMAGE_BYTES,
    AGENT_IMAGE_TYPES,
    AGENT_MODEL_BYTES,
    AGENT_MODEL_TYPES,
    agentAttachmentBytes,
    agentAttachmentType
} from '../chat/attachment-type.ts';
import { ToolRefusal } from '@adecore/agents/context';
import { imageType } from '../mcp/visual-images.ts';
import { hostService, requireChatCaller, type ServerActionContext } from './context.ts';

const MIB = 1024 * 1024;

export const chatAttachActions: ActionHandlers<ServerActionContext> = {
    'chat.attach': async ({ name, data }, { actor, context }) => {
        const images = hostService(context, 'agentImages', 'unavailable', 'This machine keeps no attachments for a chat; describe the file in text');
        await requireChatCaller(
            context,
            actor.id,
            (you) => new ToolRefusal('attach-needs-chat', `A file attaches only to the thread of an AI chat, and you are ${you}: describe it in text instead`)
        );
        const bytes = Buffer.from(data, 'base64');
        if (bytes.byteLength > AGENT_MODEL_BYTES) {
            throw new ToolRefusal(
                'attach-too-large',
                `The file is ${Math.ceil(bytes.byteLength / MIB)} MiB and at most ${AGENT_MODEL_BYTES / MIB} MiB attach for a model, ${AGENT_IMAGE_BYTES / MIB} MiB for an image`
            );
        }
        // The bytes decide the type: the daemon trusts no CLI to have checked them.
        const type = agentAttachmentType(bytes);
        if (type === null) {
            throw new ToolRefusal(
                'attach-not-image',
                `Only a ${Object.values(AGENT_IMAGE_TYPES).join(', ')} image or a ${Object.values(AGENT_MODEL_TYPES).join(', ')} model attaches, and these bytes are ${imageType(bytes) ?? 'neither'}`
            );
        }
        if (bytes.byteLength > agentAttachmentBytes(type.kind)) {
            throw new ToolRefusal(
                'attach-too-large',
                `The image is ${Math.ceil(bytes.byteLength / MIB)} MiB and at most ${AGENT_IMAGE_BYTES / MIB} MiB attach`
            );
        }
        const attachment = await images.attach(actor.id, { name, mime: type.mime, bytes });
        return { output: { attachment: { id: attachment.id, name: attachment.name, mime: attachment.mime, size: attachment.size } } };
    }
};

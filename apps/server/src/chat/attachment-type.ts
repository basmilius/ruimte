import { CHAT_MODEL_MAX_BYTES } from '@ruimte/contracts';
import { imageType, VISUAL_IMAGE_BYTES } from '../mcp/visual-images.ts';
import { sniffMime } from '../fs/sniff.ts';

/*
 * What an agent may attach to its chat, read off the bytes and never the name. The daemon checks
 * every file it reads for an agent here, whoever named the path.
 */

/* The image formats every client draws; an SVG could run script when opened on its own, so it stays out. */
export const AGENT_IMAGE_TYPES: Readonly<Record<string, string>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif'
};

/* The 3D formats a Model block draws. */
export const AGENT_MODEL_TYPES: Readonly<Record<string, string>> = {
    'model/gltf-binary': 'glb',
    'model/vnd.usdz+zip': 'usdz',
    'model/stl': 'stl'
};

export const AGENT_ATTACHMENT_TYPES: Readonly<Record<string, string>> = { ...AGENT_IMAGE_TYPES, ...AGENT_MODEL_TYPES };

export const AGENT_IMAGE_BYTES = VISUAL_IMAGE_BYTES;

export const AGENT_MODEL_BYTES = CHAT_MODEL_MAX_BYTES;

// Every signature the model sniff reads sits in the head; only a binary STL needs the whole size beside it.
const SNIFF_HEAD_BYTES = 4096;

type AgentAttachmentKind = 'image' | 'model';

interface AgentAttachmentType {
    readonly kind: AgentAttachmentKind;
    readonly mime: string;
}

/* The kind and type of bytes an agent may attach, or null for anything else, an SVG or a zip among them. */
export function agentAttachmentType(bytes: Uint8Array): AgentAttachmentType | null {
    const image = imageType(bytes);
    if (image !== null) {
        return AGENT_IMAGE_TYPES[image] === undefined ? null : { kind: 'image', mime: image };
    }
    const sniffed = sniffMime(bytes.subarray(0, SNIFF_HEAD_BYTES), bytes.length);
    return sniffed !== null && AGENT_MODEL_TYPES[sniffed] !== undefined ? { kind: 'model', mime: sniffed } : null;
}

/* The most bytes an attachment of this kind may take. */
export function agentAttachmentBytes(kind: AgentAttachmentKind): number {
    return kind === 'image' ? AGENT_IMAGE_BYTES : AGENT_MODEL_BYTES;
}

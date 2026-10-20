import type { ActionHandlers } from '@ruimte/actions';
import { isCanvasView, type ProjectContent } from '@ruimte/contracts';
import { VerbRefusal } from '../canvas/verb.ts';
import { chatExcerpt } from '../voice/chat-excerpt.ts';
import type { ServerActionContext, VoiceCaller } from './context.ts';

const DEFAULT_READ = 20;

/* Only Voice reaches these handlers: an agent reads a chat through its lines, with the rules of `context.read`. */
function voiceOf(context: ServerActionContext): VoiceCaller {
    if (context.voice === undefined) {
        throw new VerbRefusal('forbidden-action', 'Only Voice reads a chat this way');
    }
    return context.voice;
}

/* The chat node or chat view of this id in the project, by its name; null when the project holds no chat of that id. */
function chatIn(content: ProjectContent, id: string): string | null {
    for (const view of content.views) {
        if (view.kind === 'chat' && view.id === id) {
            return view.name;
        }
        const node = isCanvasView(view) ? view.nodes.find((candidate) => candidate.id === id) : undefined;
        if (node) {
            return node.kind === 'chat' ? node.title : null;
        }
    }
    return null;
}

/*
 * Refused before anything is read: a chat on another machine has nothing here but the shell it left, and
 * Voice reaches only the project its session started in, whatever id the model names. The words are for
 * the model of a voice and name no `ruimte-context` flag.
 */
async function chatOfSession(context: ServerActionContext, chatId: string): Promise<string> {
    const voice = voiceOf(context);
    const { host } = context;
    if (host.projects.machineOfNode(chatId) !== null) {
        throw new VerbRefusal('remote-target', 'That chat runs on another machine; Voice reads only the chats of this one');
    }
    const place = host.projects.locate(chatId);
    const title = place?.projectId === voice.projectId ? chatIn(await host.projects.read(voice.projectId), chatId) : null;
    if (title === null) {
        throw new VerbRefusal('not-in-project', 'That id is no AI Chat of this project; resolve the chat by its name first');
    }
    return title;
}

/* The daemon's handlers of actions that only Voice runs here, in the same registry the agents' verbs go through. */
export const voiceActions: ActionHandlers<ServerActionContext> = {
    'chat.read': async ({ chatId, limit }, { context }) => {
        const chat = await chatOfSession(context, chatId);
        const threads = context.host.chatThreads;
        if (threads === undefined) {
            throw new VerbRefusal('no-chats', 'This machine reads no chats');
        }
        const items = await threads.items(chatId);
        if (items === null) {
            // A chat node nobody ever opened has no thread yet, which is an empty one and not an error.
            return { output: { chatId, chat, messages: [], truncated: false } };
        }
        return { output: { chatId, chat, ...chatExcerpt(items, limit ?? DEFAULT_READ) } };
    }
};

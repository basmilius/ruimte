import { useState } from 'react';
import { lazyNamed } from '@adecore/ui';

// The workspace draws chats, and an extension may draw on the start screen too, so the body comes only once one is asked for.
const ChatBody = lazyNamed(() => import('@/nodes/ChatBody'), 'ChatBody');

/*
 * A chat of the machine in front as Ruimte draws it, thread and composer, inside a surface of an extension. It has the
 * keyboard while the focus is in it, as a chat view has while its body has it.
 */
export function ExtensionChat({ id, folder }: { id: string; folder?: string }) {
    const [focused, setFocused] = useState(false);

    return (
        <div
            className="chat-column flex h-full min-h-0 w-full flex-col"
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setFocused(false);
                }
            }}
        >
            <ChatBody id={id} focused={focused} {...(folder === undefined ? {} : { cwd: folder })} />
        </div>
    );
}

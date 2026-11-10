import { useState } from 'react';
import { ExtensionChatBody } from './extension-chat-body';

/*
 * A chat of the project in front as Ruimte draws it, thread and composer, inside a surface of an extension. It has the
 * keyboard while the focus is in it, as a chat view has while its body has it.
 */
export function ExtensionChat({ id }: { id: string }) {
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
            {ExtensionChatBody !== null && <ExtensionChatBody id={id} focused={focused} />}
        </div>
    );
}

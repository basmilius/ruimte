import type { AppIpc } from '@adecore/shell';
import type { InvokeArgs, InvokeChannel, InvokeResult, SendArgs, SendChannel } from '@ruimte/desktop-bridge/ipc';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';

/*
 * The app's channels with the argument tuples and answers of `@ruimte/desktop-bridge/ipc`. A handler may
 * type an argument `unknown` to validate it, but one that wants more than the preload sends, or answers
 * something else than the table says, does not compile.
 */
export interface DesktopIpc extends Omit<AppIpc, 'handle' | 'on'> {
    handle<C extends InvokeChannel>(
        channel: C,
        handler: (event: IpcMainInvokeEvent, ...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>
    ): void;
    on<C extends SendChannel>(channel: C, listener: (event: IpcMainEvent, ...args: SendArgs<C>) => void): void;
}

export function desktopIpc(ipc: AppIpc): DesktopIpc {
    return {
        handle: (channel, handler) => ipc.handle(channel, handler),
        on: (channel, listener) => ipc.on(channel, listener),
        senderWindow: (event) => ipc.senderWindow(event)
    };
}

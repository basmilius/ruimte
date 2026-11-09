import { forkDialog } from '@/chat/dialog-state';
import { machineOfNodeId } from '@/state/node-endpoint';

/* Every door to the fork dialog goes through here, so the dialog reads the chat on the machine it runs on. */
export function openForkDialog(chatId: string, turnId: string): void {
    const machine = machineOfNodeId(chatId);
    forkDialog.set({ chatId, turnId, ...(machine === undefined ? {} : { machine }) });
}

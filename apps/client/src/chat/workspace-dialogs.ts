import { lazyDialog } from '@adecore/ui';
import { useStore } from 'zustand';
import { ChatChooserMenu } from '@/chat/ChatChooserMenu';
import { ForkDialog } from '@/chat/ForkDialog';
import type { DialogContribution } from '@/registry/dialogs';
import { imageSaveDialog, type ImageSaveDialogState } from '@/surface/image-save';

const ImageSaveHost = lazyDialog(
    () => import('@/chat/ImageSaveHost'),
    'ImageSaveHost',
    (select: (state: ImageSaveDialogState) => boolean) => useStore(imageSaveDialog, select),
    (state) => state.session !== null
);

/* Only the workspace's dialog list reaches these, so they load with the workspace. The fork dialog brings its own boundary. */
export const CHAT_WORKSPACE_DIALOGS: readonly DialogContribution[] = [
    { id: 'chat-chooser', surface: 'dialog', component: ChatChooserMenu },
    { id: 'fork', surface: null, component: ForkDialog },
    { id: 'image-save', surface: 'dialog', component: ImageSaveHost }
];

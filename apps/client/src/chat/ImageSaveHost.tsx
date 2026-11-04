import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { GeneratedImageSaveDialog } from '@/chat/GeneratedImageSaveDialog';
import { imageSaveDialog, ImageSaveSession } from '@/chat/image-save';
import { ProjectFolderPicker } from '@/shell/panels/ProjectFolderPicker';
import type { Transport } from '@/transport';

function ImageSaveBody({ session, transport }: { session: ImageSaveSession; transport: Transport }) {
    const { t } = useTranslation('chat');
    const state = useStore(session.state);
    const path = session.pathOf(state);
    return (
        <GeneratedImageSaveDialog
            open={!state.closed}
            onOpenChange={(open) => !open && session.close()}
            projectName={session.root.projectName}
            folderTree={
                <ProjectFolderPicker
                    root={session.root.folder}
                    transport={transport}
                    label={t('generatedImage.folder')}
                    onSelect={(directory) => session.selectDirectory(directory)}
                    onError={(error) => session.state.setState({ error })}
                />
            }
            fileName={state.name}
            onFileNameChange={(name) => session.name(name)}
            destinationPath={path}
            pending={state.pending}
            error={state.error}
            exists={state.target?.exists === true}
            canSave={session.canSave(state)}
            onSave={() => void session.save(false)}
            onReplace={() => void session.save(true)}
        />
    );
}

export function ImageSaveHost() {
    const session = useStore(imageSaveDialog, (state) => state.session);
    useEffect(() => () => session?.close(), [session]);
    return session === null ? null : <ImageSaveBody key={session.root.folder} session={session} transport={session.transport} />;
}

import { messageOf } from '@adecore/ui';
import type { DevcontainerStart } from '@ruimte/desktop-bridge';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openDevcontainerFolder, useDevcontainerActions, useDevcontainerJoin } from '@/machine-ui/devcontainers';
import { MachineCandidateDetail } from '@/machine-ui/MachineCandidateDetail';

/* A folder this app starts in a dev container itself, in the detail a place of an extension has. */
export function DevcontainerDetail({ start }: { start: DevcontainerStart }) {
    const { t } = useTranslation('settings');
    const actions = useDevcontainerActions(start);
    const [openFailure, setOpenFailure] = useState<string | null>(null);
    const folder = start.workspaceFolder ?? start.folder;

    return (
        <MachineCandidateDetail
            candidate={start.candidate}
            actions={{ ...actions, failure: actions.failure ?? openFailure }}
            join={useDevcontainerJoin(start)}
            heldDescription={t('machines.devcontainer.held', { folder: start.folder })}
            joined={{
                text: t('machines.devcontainer.joined', { folder }),
                open() {
                    setOpenFailure(null);
                    openDevcontainerFolder(start).catch((e: unknown) => setOpenFailure(messageOf(e)));
                }
            }}
        />
    );
}

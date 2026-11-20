import type { ProjectDesignView } from '@ruimte/contracts';
import { DesignSurface } from '@/design/DesignSurface';
import { activeDesignChat, placeOfView, useDesignChat } from '@/state/design-chat';
import { useDesignFolder } from '@/state/design-places';

export function DesignView({ view, focused }: { view: ProjectDesignView; focused: boolean }) {
    const design = placeOfView(view);
    const { folder, projectFolder } = useDesignFolder(design);
    const picked = useDesignChat((state) => state.picked);

    return <DesignSurface designId={view.id} chatId={activeDesignChat(design, picked)} folder={folder} watched={projectFolder} focused={focused} />;
}

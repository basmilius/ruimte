import { useTranslation } from 'react-i18next';
import { readDesignPage } from '@/design/design-read';
import { useProject } from '@/state/project';
import { PageReadFrame } from '@/surface/PageReadFrame';

interface DesignPageFrameProps {
    endpointId: string;
    designId: string;
    folder: string;
    file: string;
}

export function DesignPageFrame({ endpointId, designId, folder, file }: DesignPageFrameProps) {
    const { t } = useTranslation('shell');
    const projectId = useProject((s) => s.current?.projectId ?? null);

    return (
        <PageReadFrame
            read={() => readDesignPage(endpointId, { projectId, designId, folder }, file)}
            readKey={`${endpointId}:${folder}:${file}`}
            title={file}
            name={file}
            readingLabel={t('design.loading')}
        />
    );
}

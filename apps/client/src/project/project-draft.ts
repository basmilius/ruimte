import { ProjectDocumentSchema, type ProjectDocument } from '@ruimte/contracts';
import { z } from 'zod';
import { endpointKey } from '@/state/keys';
import type { LastProjectStorage } from './last-project';
import i18next from 'i18next';

const DraftSchema = z.object({ base: ProjectDocumentSchema, document: ProjectDocumentSchema });
const keyOf = (endpointId: string, projectId: string): string => `ruimte.projectDraft.${endpointKey(endpointId, projectId)}`;

export const readProjectDraft = (storage: LastProjectStorage | null, endpointId: string, projectId: string): z.infer<typeof DraftSchema> | null => {
    const text = storage?.getItem(keyOf(endpointId, projectId));
    return text ? DraftSchema.parse(JSON.parse(text)) : null;
};

export const writeProjectDraft = (
    storage: LastProjectStorage | null,
    endpointId: string,
    projectId: string,
    base: ProjectDocument,
    document: ProjectDocument
): void => {
    if (!storage) {
        throw new Error(i18next.t('project:error.projectNotSaved'));
    }
    const key = keyOf(endpointId, projectId);
    const text = JSON.stringify({ base, document });
    storage.setItem(key, text);
    if (storage.getItem(key) !== text) {
        throw new Error(i18next.t('project:error.projectNotSaved'));
    }
};

export const dropProjectDraft = (storage: LastProjectStorage | null, endpointId: string, projectId: string): void => {
    storage?.removeItem(keyOf(endpointId, projectId));
};

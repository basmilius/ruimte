import { ProjectDocumentSchema, type ProjectDocument } from '@ruimte/contracts';
import { z } from 'zod';
import i18next from 'i18next';
import { endpointKey } from '@/state/keys';
import type { LastProjectStorage } from './last-project';

const DraftSchema = z.object({ base: ProjectDocumentSchema, document: ProjectDocumentSchema });

function keyOf(endpointId: string, projectId: string): string {
    return `ruimte.projectDraft.${endpointKey(endpointId, projectId)}`;
}

export function readProjectDraft(storage: LastProjectStorage | null, endpointId: string, projectId: string): z.infer<typeof DraftSchema> | null {
    const text = storage?.getItem(keyOf(endpointId, projectId));
    return text ? DraftSchema.parse(JSON.parse(text)) : null;
}

export function writeProjectDraft(
    storage: LastProjectStorage | null,
    endpointId: string,
    projectId: string,
    base: ProjectDocument,
    document: ProjectDocument
): void {
    if (!storage) {
        throw new Error(i18next.t('project:error.projectNotSaved'));
    }
    const key = keyOf(endpointId, projectId);
    const text = JSON.stringify({ base, document });
    storage.setItem(key, text);
    if (storage.getItem(key) !== text) {
        throw new Error(i18next.t('project:error.projectNotSaved'));
    }
}

export function dropProjectDraft(storage: LastProjectStorage | null, endpointId: string, projectId: string): void {
    storage?.removeItem(keyOf(endpointId, projectId));
}

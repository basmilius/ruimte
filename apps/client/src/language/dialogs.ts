import { lazyDialog } from '@adecore/ui';
import { useTemplateRequest } from '@/language/template-request';
import type { DialogContribution } from '@/registry/dialogs';

const TemplateRequestDialog = lazyDialog(
    () => import('@/language/TemplateDialog'),
    'TemplateRequestDialog',
    useTemplateRequest,
    (s) => s.request !== null
);

export const LANGUAGE_DIALOGS: readonly DialogContribution[] = [{ id: 'template-request', surface: 'templateRequest', component: TemplateRequestDialog }];

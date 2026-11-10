import { create } from 'zustand';
import type { TemplateDraft } from '@/language/template-draft';
import type { TemplatesTracker } from '@/language/templates';

interface TemplateRequest {
    tracker: TemplatesTracker;
    draft: TemplateDraft;
}

interface TemplateRequestStore {
    request: TemplateRequest | null;
    setRequest(request: TemplateRequest | null): void;
}

export const useTemplateRequest = create<TemplateRequestStore>((set) => ({
    request: null,
    setRequest(request) {
        set({ request });
    }
}));

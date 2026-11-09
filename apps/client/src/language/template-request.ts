import { create } from 'zustand';
import type { TemplateDraft } from '@/language/template-draft';
import type { TemplatesTracker } from '@/language/templates';

/* The template form Save as Live Template opens, with the tracker of the project it was asked in. */
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

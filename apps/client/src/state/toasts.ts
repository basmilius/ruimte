import { createToastStore, type Toast as UiToast } from '@adecore/ui';

export interface Toast extends UiToast {
    /* Everything the command wrote, behind the copy button of a failure. */
    output?: string;
}

/*
 * The one place the app says how something went. Every git action runs through it: one toast that
 * starts as progress, follows the phases while git runs and ends as the summary or the failure, so
 * a person never watches two cards for one push.
 */
export const useToasts = createToastStore<Toast>();

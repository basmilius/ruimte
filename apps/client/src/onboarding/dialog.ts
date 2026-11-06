import { lazyDialog } from '@adecore/ui';
import { createDialogState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

/* Where the onboarding stands while it is up: the welcome, or the list of tasks behind it. */
export type OnboardingStep = 'welcome' | 'hub';

export const onboardingDialog = createDialogState<OnboardingStep>();

const OnboardingDialog = lazyDialog(
    () => import('@/onboarding/OnboardingDialog'),
    'OnboardingDialog',
    onboardingDialog.store,
    (state) => state.request !== null
);

export const ONBOARDING_DIALOGS: readonly DialogContribution[] = [{ id: 'onboarding', surface: 'onboarding', component: OnboardingDialog }];

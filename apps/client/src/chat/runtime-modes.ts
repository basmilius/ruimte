import i18next from 'i18next';
import type { RuntimeMode } from '@ruimte/contracts';

/*
 * The runtime modes in the order they are offered, shared by the composer's mode picker, the
 * settings dialog and the agent menus. Only the ids live here: the words are in `modes.<id>` of the
 * `chat` namespace, read when a surface draws one rather than when this module loads.
 */
export const RUNTIME_MODES: readonly RuntimeMode[] = ['supervised', 'auto-accept-edits', 'auto', 'full-access'];

export const runtimeModeLabel = (mode: RuntimeMode): string => i18next.t(`chat:modes.${mode}.label`);

export const runtimeModeHint = (mode: RuntimeMode): string => i18next.t(`chat:modes.${mode}.hint`);

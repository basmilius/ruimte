import i18next from 'i18next';
import { RuntimeModeSchema, type RuntimeMode } from '@ruimte/agent-contracts';

/*
 * The runtime modes in the order they are offered, shared by the composer's mode picker, the
 * settings dialog and the agent menus. That order is the schema's, which the host reads as the
 * rank from narrowest to widest. Only the ids live here: the words are in `modes.<id>` of the `chat`
 * namespace, read when a surface draws one rather than when this module loads.
 */
export const RUNTIME_MODES: readonly RuntimeMode[] = RuntimeModeSchema.options;

export const runtimeModeLabel = (mode: RuntimeMode): string => i18next.t(`agent-chat:modes.${mode}.label`);

export const runtimeModeHint = (mode: RuntimeMode): string => i18next.t(`agent-chat:modes.${mode}.hint`);

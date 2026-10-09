import i18next from 'i18next';
import { createElement, useMemo } from 'react';
import { chatHost, setChatHost } from '@adecore/agents-react/host';
import { answerComputerAsPerson } from '@/actions/client-actions';
import { ComposerDictation } from '@/chat/ComposerDictation';
import { prepareCodeBlockAction } from '@/chat/prepare-code-block';
import { useProjectChats } from '@/chat/project-chats';
import { openUiLink, openUiUrl } from '@/chat/ui-links';
import { ReadImage } from '@/chat/ReadImage';
import { useTimelineFind } from '@/chat/use-chat-find';
import { useChatPlace } from '@/chat/use-chat-place';
import { useContextSources } from '@/context/sources';
import { isApplePlatform } from '@/desktop/bridge';
import { DictationTextarea } from '@/dictation/DictationTextarea';
import { dictationPreview, dictationRange } from '@/dictation/editor';
import { answerRuimtePrompt, computerPrompt, isRuimtePrompt } from '@/prompts/ruimte-prompts';
import { RuimtePromptView } from '@/prompts/RuimtePromptView';
import { openFileLink, parseFileRef, resolveFileRef, type FileRef } from '@/shell/panels/file-links';
import { useNodeComputerApprovals } from '@/state/computer';
import { useToasts } from '@/state/toasts';
import { isShellShortcut } from '@/terminal/keymap';

/*
 * What the chat takes from Ruimte that only a workspace draws: the find over a thread, dictation, the
 * cards the machine raises beside a chat's own prompts, and the ways to a file or another chat of the
 * project. Handed over when the workspace chunk loads, before anything in it renders.
 */
export function connectWorkspaceChatHost(): void {
    const intelligentUi = chatHost().intelligentUi;
    setChatHost({
        ...(intelligentUi ? { intelligentUi: { ...intelligentUi, openLink: openUiLink, openUrl: openUiUrl } } : {}),
        isAppShortcut: (event) => isShellShortcut(event, isApplePlatform()),
        ReadImage,
        renderShellCodeBlock: prepareCodeBlockAction,
        fileLinks: {
            target: (text, cwd, scopeId) => {
                const ref = parseFileRef(text, true);
                return !scopeId || ref === null || resolveFileRef(cwd, ref) === null ? null : ref;
            },
            open: (cwd, ref: FileRef, scopeId) => {
                if (!scopeId) {
                    useToasts.getState().show({ kind: 'error', title: i18next.t('panels:file.locationUnavailable') });
                    return;
                }
                void openFileLink(cwd, ref, scopeId);
            }
        },
        useTimelineFind,
        dictation: { Textarea: DictationTextarea, composer: { extensions: [dictationRange, dictationPreview], Control: ComposerDictation } },
        prompts: {
            useExtra: (endpointId, chatId) => {
                const requests = useNodeComputerApprovals(endpointId, chatId);
                return useMemo(() => requests.map((request) => computerPrompt(chatId, request)), [requests, chatId]);
            },
            render: (prompt, props) => (isRuimtePrompt(prompt) ? createElement(RuimtePromptView, { prompt, props }) : null),
            answer: (prompt, action) => answerRuimtePrompt(prompt, action, answerComputerAsPerson)
        },
        useReferableChats: useProjectChats,
        useChatPlace,
        useContextSources
    });
}

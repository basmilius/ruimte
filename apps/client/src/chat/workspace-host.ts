import i18next from 'i18next';
import { createElement, useMemo } from 'react';
import type { ChatHost } from '@adecore/agents-react';
import { answerComputerAsPerson } from '@/actions/client-actions';
import { CHAT_HOST } from '@/chat/host';
import { ChatModelView } from '@/chat/ChatModelView';
import { ComposerDictation } from '@/chat/ComposerDictation';
import { prepareCodeBlockAction } from '@/chat/prepare-code-block';
import { useProjectChats } from '@/chat/project-chats';
import { openUiLink, openUiUrl } from '@/chat/ui-links';
import { openNewChatAfterSend } from '@/chat/new-chat-after-send';
import { MarkdownImage, ReadImage } from '@/chat/ReadImage';
import { useTimelineFind } from '@/chat/use-chat-find';
import { useChatPlace } from '@/chat/use-chat-place';
import { useContextSources } from '@/context/sources';
import { isApplePlatform } from '@/desktop/bridge';
import { DictationTextarea } from '@/dictation/DictationTextarea';
import { dictationPreview, dictationRange } from '@/dictation/editor';
import { answerRuimtePrompt, computerPrompt, isRuimtePrompt, proposalPrompt, secretPrompt } from '@/prompts/ruimte-prompts';
import { proposalAnswers } from '@/proposals/answer';
import { RuimtePromptView } from '@/prompts/RuimtePromptView';
import { openFileLink, parseFileRef, resolveFileRef, type FileRef } from '@/shell/panels/file-links';
import { secretAnswers } from '@/secrets/answer';
import { useNodeComputerApprovals } from '@/state/computer';
import { useNodeProposals } from '@/state/proposals';
import { useNodeSecretRequests } from '@/state/secrets';
import { useToasts } from '@/state/toasts';
import { isComposerShortcut } from '@/terminal/keymap';

/*
 * What the chat takes from Ruimte that only a workspace draws: the find over a thread, dictation, the
 * cards the machine raises beside a chat's own prompts, the ways to a file or another chat of the
 * project, the 3D view of a Model block, and the new chat a send opens beside its own. The workspace
 * hands it to the chat views under it, over `CHAT_HOST`.
 */
const intelligentUi = CHAT_HOST.intelligentUi;

export const WORKSPACE_CHAT_HOST: Partial<ChatHost> = {
    ...(intelligentUi ? { intelligentUi: { ...intelligentUi, openLink: openUiLink, openUrl: openUiUrl } } : {}),
    isAppShortcut: (event) => isComposerShortcut(event, isApplePlatform()),
    ReadImage,
    MarkdownImage,
    ModelView: ChatModelView,
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
            const secrets = useNodeSecretRequests(endpointId, chatId);
            const proposals = useNodeProposals(endpointId, chatId);
            return useMemo(
                () => [
                    ...requests.map((request) => computerPrompt(chatId, request)),
                    ...secrets.map((request) => secretPrompt(endpointId, chatId, request)),
                    ...proposals.map((proposal) => proposalPrompt(endpointId, chatId, proposal))
                ],
                [requests, secrets, proposals, endpointId, chatId]
            );
        },
        render: (prompt, props) => (isRuimtePrompt(prompt) ? createElement(RuimtePromptView, { prompt, props }) : null),
        answer: (prompt, action) => answerRuimtePrompt(prompt, action, answerComputerAsPerson, secretAnswers, proposalAnswers)
    },
    openNewChat: (endpointId, chatId) => void openNewChatAfterSend(endpointId, chatId),
    useReferableChats: useProjectChats,
    useChatPlace,
    useContextSources
};

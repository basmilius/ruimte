import type { ChatHost } from '@adecore/agents-react';
import i18next from 'i18next';
import { createElement, useMemo } from 'react';
import { answerComputerAsPerson } from '@/action-port/person-actions';
import { ChatModelView } from '@/chat/ChatModelView';
import { ComposerDictation } from '@/chat/ComposerDictation';
import { CHAT_HOST } from '@/chat/host';
import { openNewChatAfterSend } from '@/chat/new-chat-after-send';
import { prepareCodeBlockAction } from '@/chat/prepare-code-block';
import { useProjectChats } from '@/chat/project-chats';
import { MarkdownImage, ReadImage } from '@/chat/ReadImage';
import { openReference, useReferables } from '@/chat/referables';
import { ReferenceGlyph } from '@/chat/ReferenceGlyph';
import { openUiLink, openUiUrl } from '@/chat/ui-links';
import { useTimelineFind } from '@/chat/use-chat-find';
import { useChatPlace } from '@/project/use-chat-place';
import { useContextSources } from '@/context/sources';
import { DesignComposerHeader } from '@/design/DesignChats';
import { isApplePlatform } from '@/desktop/bridge';
import { DictationTextarea } from '@/dictation/DictationTextarea';
import { dictationPreview, dictationRange } from '@/dictation/editor';
import { saveToOutputActions } from '@/output/save';
import { useOutputThreadCards } from '@/output/thread-cards';
import { answerRuimtePrompt, computerPrompt, isRuimtePrompt, proposalPrompt, secretPrompt } from '@/prompts/ruimte-prompts';
import { RuimtePromptView } from '@/prompts/RuimtePromptView';
import { proposalAnswers } from '@/proposals/answer';
import { secretAnswers } from '@/secrets/answer';
import { useNodeComputerApprovals } from '@/state/computer';
import { useDesignHidesToolCalls } from '@/state/design-tool-calls';
import { useNodeProposals } from '@/state/proposals';
import { useNodeSecretRequests } from '@/state/secrets';
import { useToasts } from '@/state/toasts';
import { openFileLink, parseFileRef, resolveFileRef, type FileRef } from '@/surface/panels/file-links';
import { isComposerShortcut } from '@/surface/terminal-keymap';

/*
 * What the chat takes from Ruimte that only a workspace draws: the find over a thread, dictation, the
 * cards the machine raises beside a chat's own prompts, a card in the thread for what it saved to
 * Output, the ways to a file or another chat of the project, the 3D view of a Model block, and the new
 * chat a send opens beside its own. The workspace hands it to the chat views under it, over `CHAT_HOST`.
 */
const intelligentUi = CHAT_HOST.intelligentUi;
// `CHAT_HOST` always sets both; it is typed as a part of a host since the library fills in the rest.
const attachments = CHAT_HOST.attachments!;
const visuals = CHAT_HOST.visuals ?? null;

export const WORKSPACE_CHAT_HOST: Partial<ChatHost> = {
    ...(intelligentUi ? { intelligentUi: { ...intelligentUi, openLink: openUiLink, openUrl: openUiUrl } } : {}),
    isAppShortcut: (event) => isComposerShortcut(event, isApplePlatform()),
    ReadImage,
    MarkdownImage,
    ModelView: ChatModelView,
    ComposerHeaderSlot: DesignComposerHeader,
    useHidesToolCalls: useDesignHidesToolCalls,
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
            // Kept by hand: the React Compiler leaves a hook in an object literal as written.
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
    useReferables,
    ReferenceIcon: ReferenceGlyph,
    openReference,
    useChatPlace,
    useContextSources,
    useThreadCards: useOutputThreadCards,
    // Saving needs the project the chat is in, which only a workspace has.
    attachments: {
        ...attachments,
        actions: (scopeId, chatId, attachment) =>
            attachment.mime.startsWith('image/')
                ? saveToOutputActions(scopeId, { kind: 'attachment', chatId, attachmentId: attachment.id }, attachment.name)
                : []
    },
    visuals:
        visuals === null
            ? null
            : {
                  ...visuals,
                  actions: (scopeId, chatId, visual) => saveToOutputActions(scopeId, { kind: 'visual', chatId, visualId: visual.id }, visual.title)
              }
};

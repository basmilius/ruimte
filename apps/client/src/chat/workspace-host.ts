import { createElement, useMemo } from 'react';
import { setChatHost } from '@ruimte/agents-react/host';
import { answerComputerAsPerson } from '@/actions/client-actions';
import { ComposerDictation } from '@/chat/ComposerDictation';
import { useProjectChats } from '@/chat/project-chats';
import { ReadImage } from '@/chat/ReadImage';
import { useTimelineFind } from '@/chat/use-chat-find';
import { useChatPlace } from '@/chat/use-chat-place';
import { useContextSources } from '@/context/sources';
import { isApplePlatform } from '@/desktop/bridge';
import { DictationTextarea } from '@/dictation/DictationTextarea';
import { dictationPreview, dictationRange } from '@/dictation/editor';
import { answerRuimtePrompt, computerPrompt, isRuimtePrompt } from '@/prompts/ruimte-prompts';
import { RuimtePromptView } from '@/prompts/RuimtePromptView';
import { openFileLink, parseFileRef, resolveFileRef } from '@/shell/panels/file-links';
import { useNodeComputerApprovals } from '@/state/computer';
import { useProject } from '@/state/project';
import { isShellShortcut } from '@/terminal/keymap';

/*
 * What the chat takes from Ruimte that only a workspace draws: the find over a thread, dictation, the
 * cards the machine raises beside a chat's own prompts, and the ways to a file or another chat of the
 * project. Handed over when the workspace chunk loads, before anything in it renders.
 */
export const connectWorkspaceChatHost = (): void => {
    setChatHost({
        isAppShortcut: (event) => isShellShortcut(event, isApplePlatform()),
        ReadImage,
        fileLinks: {
            target: (text, cwd) => {
                const ref = parseFileRef(text);
                return ref === null || resolveFileRef(cwd, ref) === null ? null : ref;
            },
            // A thread with no cwd of its own (a sub-agent's) counts from the project.
            open: (cwd, ref) => void openFileLink(cwd ?? useProject.getState().current?.folder ?? null, ref)
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
};

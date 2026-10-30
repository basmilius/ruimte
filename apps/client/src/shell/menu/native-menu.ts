import i18next from 'i18next';
import { useEffect } from 'react';
import { desktop } from '@/desktop/bridge';
import { useLaunches } from '@/launches/state';
import { useNewChat } from '@/project/new-chat';
import { runMenuCommand } from '@/shell/menu/actions';
import { menuContext } from '@/shell/menu/context';
import { menuModel } from '@/shell/menu/model';
import { subscribeCanvases } from '@/state/canvas';
import { useProvidersStore } from '@adecore/agents-react/state';
import { subscribeChatThreads } from '@/state/chats';
import { useDocument } from '@/state/document';
import { usePrRepos } from '@/state/pr-repos';
import { useProject } from '@/state/project';
import { useProposals } from '@/state/proposals';
import { useServers } from '@/state/server';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';
import { usePromptStacks } from '@/canvas/prompt-stack';
import { useSnoozes } from '@/state/snooze';
import { subscribeCameraHistories } from '@/state/camera-history';
import { subscribeFocusedEditors } from '@/shell/panels/focused-editor';
import { subscribeFocusedLanguages } from '@/language/focused-language';

/* A chat streams word by word and a camera moves every frame; the menu only needs where things settled. */
const SETTLE_MS = 100;

/* Mounted once by the app: keeps the shell's native menu on what has the focus and runs its clicks. */
export function useNativeMenu(): void {
    useEffect(() => {
        const bridge = desktop();
        const setMenu = bridge?.setMenu;
        if (!bridge || !setMenu) {
            return;
        }
        let sent = '';
        let timer: ReturnType<typeof setTimeout> | null = null;
        const send = (): void => {
            timer = null;
            const spec = menuModel(menuContext('desktop'));
            const text = JSON.stringify(spec);
            if (text !== sent) {
                sent = text;
                setMenu(spec);
            }
        };
        const schedule = (): void => {
            if (timer === null) {
                timer = setTimeout(send, SETTLE_MS);
            }
        };
        const unsubscribes = [
            useDocument.subscribe(schedule),
            useUi.subscribe(schedule),
            useProject.subscribe(schedule),
            useProvidersStore.subscribe(schedule),
            subscribeChatThreads(schedule),
            useSessions.subscribe(schedule),
            useProposals.subscribe(schedule),
            useSettings.subscribe(schedule),
            useServers.subscribe(schedule),
            useWindow.subscribe(schedule),
            useLaunches.subscribe(schedule),
            usePrRepos.subscribe(schedule),
            useNewChat.subscribe(schedule),
            usePromptStacks.subscribe(schedule),
            useSnoozes.subscribe(schedule),
            subscribeCameraHistories(schedule),
            subscribeFocusedEditors(schedule),
            subscribeFocusedLanguages(schedule),
            subscribeCanvases(schedule),
            bridge.onMenuCommand?.(runMenuCommand) ?? (() => undefined)
        ];
        i18next.on('languageChanged', schedule);
        // A terminal taking or losing the keyboard moves the clear key between Clear and the palette.
        window.addEventListener('focusin', schedule);
        window.addEventListener('focusout', schedule);
        send();
        return () => {
            if (timer !== null) {
                clearTimeout(timer);
            }
            i18next.off('languageChanged', schedule);
            window.removeEventListener('focusin', schedule);
            window.removeEventListener('focusout', schedule);
            for (const unsubscribe of unsubscribes) {
                unsubscribe();
            }
        };
    }, []);
}

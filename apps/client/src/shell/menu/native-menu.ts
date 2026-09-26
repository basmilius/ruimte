import i18next from 'i18next';
import { useEffect } from 'react';
import { desktop } from '@/desktop/bridge';
import { runMenuCommand } from '@/shell/menu/actions';
import { menuContext } from '@/shell/menu/context';
import { menuModel } from '@/shell/menu/model';
import { subscribeCanvases } from '@/state/canvas';
import { useChats } from '@ruimte/agents-react/state/chats';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useProvidersStore } from '@ruimte/agents-react/state/providers';
import { useServers } from '@/state/server';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';

/* A chat streams word by word and a camera moves every frame; the menu only needs where things settled. */
const SETTLE_MS = 100;

/* Mounted once by the app: keeps the shell's native menu on what has the focus and runs its clicks. */
export const useNativeMenu = (): void => {
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
            timer ??= setTimeout(send, SETTLE_MS);
        };
        const unsubscribes = [
            useDocument.subscribe(schedule),
            useUi.subscribe(schedule),
            useProject.subscribe(schedule),
            useProvidersStore.subscribe(schedule),
            useChats.subscribe(schedule),
            useSessions.subscribe(schedule),
            useSettings.subscribe(schedule),
            useServers.subscribe(schedule),
            useWindow.subscribe(schedule),
            subscribeCanvases(schedule),
            bridge.onMenuCommand?.(runMenuCommand) ?? (() => undefined)
        ];
        i18next.on('languageChanged', schedule);
        send();
        return () => {
            if (timer !== null) {
                clearTimeout(timer);
            }
            i18next.off('languageChanged', schedule);
            for (const unsubscribe of unsubscribes) {
                unsubscribe();
            }
        };
    }, []);
};

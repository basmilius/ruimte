import { create } from 'zustand';
import type { Workspace } from '@/transport/connections';

/*
 * What a window shows: the start screen, or one workspace with a project in it. There is no third
 * state, so nothing inside a workspace has to ask whether a project is open.
 */
export type WindowContent = { kind: 'start' } | { kind: 'workspace'; workspace: Workspace };

interface WindowState {
    content: WindowContent;
    /* The cold start is still trying the last project, so the start screen waits rather than flashing. */
    booting: boolean;
    show(content: WindowContent): void;
    setBooting(booting: boolean): void;
}

const START: WindowContent = { kind: 'start' };

export const useWindow = create<WindowState>((set) => ({
    content: START,
    booting: true,
    show(content) {
        set({ content });
    },
    setBooting(booting) {
        set({ booting });
    }
}));

export const workspaceOf = (content: WindowContent): Workspace | null => (content.kind === 'workspace' ? content.workspace : null);

/* The workspace on screen, for code outside React. */
export const windowWorkspace = (): Workspace | null => workspaceOf(useWindow.getState().content);

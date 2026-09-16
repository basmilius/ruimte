import { create } from 'zustand';
import type { Workspace } from '@/transport/connections';

/*
 * What a window shows: the start screen, or one workspace with a project in it. There is no third
 * state, so nothing inside a workspace has to ask whether a project is open.
 */
export type WindowContent = { kind: 'start' } | { kind: 'workspace'; workspace: Workspace };

/* The project the cold start could not open, which the start screen puts on top with the reason. */
export interface BootFailure {
    endpointId: string;
    projectId: string;
    reason: string;
}

interface WindowState {
    content: WindowContent;
    /* The cold start is still trying the last project, so the start screen waits rather than flashing. */
    booting: boolean;
    bootFailure: BootFailure | null;
    show(content: WindowContent): void;
    setBooting(booting: boolean): void;
    setBootFailure(failure: BootFailure | null): void;
}

const START: WindowContent = { kind: 'start' };

export const useWindow = create<WindowState>((set) => ({
    content: START,
    booting: true,
    bootFailure: null,
    show(content) {
        // A project that opens is past whatever the cold start could not do.
        set(content.kind === 'workspace' ? { content, bootFailure: null } : { content });
    },
    setBooting(booting) {
        set({ booting });
    },
    setBootFailure(bootFailure) {
        set({ bootFailure });
    }
}));

export const workspaceOf = (content: WindowContent): Workspace | null => (content.kind === 'workspace' ? content.workspace : null);

/* The workspace on screen, for code outside React. */
export const windowWorkspace = (): Workspace | null => workspaceOf(useWindow.getState().content);

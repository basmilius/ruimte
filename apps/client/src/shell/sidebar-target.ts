export interface SidebarTarget {
    endpointId: string;
    projectId: string;
    viewId: string;
    nodeId?: string;
}

export interface SidebarNavigation {
    open(endpointId: string, projectId: string): Promise<string>;
    current(): { endpointId: string | null; projectId: string | null };
    reveal(target: SidebarTarget): void;
}

export const sidebarNavigator = (navigation: SidebarNavigation): ((target: SidebarTarget) => Promise<void>) => {
    let serial = 0;
    return async (target) => {
        const attempt = ++serial;
        const outcome = await navigation.open(target.endpointId, target.projectId);
        const current = navigation.current();
        if (attempt !== serial || outcome !== 'done' || current.endpointId !== target.endpointId || current.projectId !== target.projectId) {
            return;
        }
        navigation.reveal(target);
    };
};

import { desktop, type DesktopBridge } from '@/desktop/bridge';
import { endpointKey } from '@/state/keys';
import { windowSearch } from '@/state/window-target';

/* The address of this page, which a test stands in for. */
export interface WindowAddress {
    search(): string;
    replace(search: string): void;
}

function pageAddress(): WindowAddress | null {
    return typeof history === 'undefined'
        ? null
        : {
              search: () => location.search,
              replace: (search) => history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`)
          };
}

/*
 * Asks the shell for this window to show a project, or nothing (null). A project is in one window
 * at a time, so this is false when another window has it; the shell brought that one to the front.
 * Granted at once where no shell keeps windows, a browser among them. Once granted the address
 * follows, so a reload opens what the window shows.
 */
export async function claimWindow(
    project: { endpointId: string; projectId: string } | null,
    shell: Pick<DesktopBridge, 'claimWindow'> | null = desktop(),
    address: WindowAddress | null = pageAddress()
): Promise<boolean> {
    const claim = shell?.claimWindow;
    if (!claim) {
        return true;
    }
    const key = project === null ? null : endpointKey(project.endpointId, project.projectId);
    // A shell that does not answer is no reason to keep a person out of their project.
    const granted = await claim(key).catch(() => true);
    if (granted && address !== null) {
        const search = windowSearch(address.search(), key);
        if (search !== address.search()) {
            address.replace(search);
        }
    }
    return granted;
}

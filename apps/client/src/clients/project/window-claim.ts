import { auxWindowKey } from '@ruimte/desktop-bridge';
import { desktop, type DesktopBridge } from '@/desktop/bridge';
import { endpointKey } from '@/state/keys';
import { auxWindowId, windowSearch } from '@/state/window-target';

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
    address: WindowAddress | null = pageAddress(),
    aux: string | null = auxWindowId()
): Promise<boolean> {
    const claim = shell?.claimWindow;
    if (!claim) {
        return true;
    }
    const key = project === null ? null : endpointKey(project.endpointId, project.projectId);
    // Under a key of its own, or the claim would take the project from the window that has it.
    const claimed = key === null || aux === null ? key : auxWindowKey(key, aux);
    // A shell that does not answer is no reason to keep a person out of their project.
    const granted = await claim(claimed).catch(() => true);
    if (granted && address !== null) {
        const search = windowSearch(address.search(), key);
        if (search !== address.search()) {
            address.replace(search);
        }
    }
    return granted;
}

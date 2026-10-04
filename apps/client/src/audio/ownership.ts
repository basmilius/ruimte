import { desktop } from '@/desktop/bridge';

let owner: { release(): void } | null = null;
let hearsOtherWindows = false;

function releaseOwner(): void {
    const previous = owner;
    owner = null;
    previous?.release();
}

export function claimMicrophone(release: () => void): () => void {
    releaseOwner();
    const claim = { release };
    owner = claim;
    const bridge = desktop()?.microphone;
    if (bridge && !hearsOtherWindows) {
        hearsOtherWindows = true;
        bridge.onClaimed(releaseOwner);
    }
    bridge?.claim();
    return () => {
        if (owner === claim) {
            owner = null;
        }
    };
}

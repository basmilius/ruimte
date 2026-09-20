let owner: { release(): void } | null = null;

export const claimMicrophone = (release: () => void): (() => void) => {
    const previous = owner;
    owner = null;
    previous?.release();
    const claim = { release };
    owner = claim;
    return () => {
        if (owner === claim) {
            owner = null;
        }
    };
};

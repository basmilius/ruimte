/*
 * The order the shell sorts the release list in has to be the order the page reads it in, or the
 * notes of a version land under the wrong heading. One comparison, so the two cannot disagree.
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/* A plain `1.2.3`. A git tag carries a `v` in front of it, which is the tag's and not the version's. */
export const isVersion = (version: string): boolean => SEMVER.test(version);

/* Negative when `a` is older than `b`. A version that is not semver sorts below every one that is. */
export const compareVersions = (a: string, b: string): number => {
    const left = SEMVER.exec(a);
    const right = SEMVER.exec(b);
    if (!left || !right) {
        return (left ? 1 : 0) - (right ? 1 : 0);
    }
    for (let i = 1; i <= 3; i++) {
        const difference = Number(left[i]) - Number(right[i]);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
};

import { Tooltip } from '@basmilius/desktop-ui';

/*
 * A path that gives way from its start, so the end of it, which names the place, stays readable. The
 * full path is in the tooltip. The `bdi` keeps the slashes in reading order inside the right-to-left box.
 */
export function PathText({ path, className = '' }: { path: string; className?: string }) {
    if (path === '') {
        return null;
    }
    return (
        <Tooltip label={path}>
            <span className={`min-w-0 overflow-hidden text-left text-ellipsis whitespace-nowrap [direction:rtl] ${className}`}>
                <bdi>{path}</bdi>
            </span>
        </Tooltip>
    );
}

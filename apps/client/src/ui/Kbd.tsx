import { isApplePlatform } from '@/desktop/bridge';
import { formatShortcut, type Shortcut } from '@/ui/shortcut';

/* A shortcut as this platform prints it: `⌘K` on macOS, `Ctrl+K` elsewhere. */
export function Kbd({ shortcut, className }: { shortcut: Shortcut; className?: string }) {
    return <kbd className={className}>{formatShortcut(shortcut, isApplePlatform())}</kbd>;
}

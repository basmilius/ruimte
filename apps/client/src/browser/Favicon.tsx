import { useState } from 'react';
import { Globe } from 'lucide-react';
import { useBrowserRow } from '@/browser/registry';
import { Icon } from '@/ui/Icon';

/*
 * The icon a browser node wears: the page's own favicon where there is one, the globe until then.
 * A file that fails to load falls back for good, so a row never shows a broken image; the url the
 * project's local file remembers is what it draws before the page is back.
 */
export function Favicon({ id, size = 16 }: { id: string; size?: number }) {
    const url = useBrowserRow(id, (row) => row?.favicon ?? null);
    const [failed, setFailed] = useState<string | null>(null);

    if (!url || url === failed) {
        return <Icon icon={Globe} size={size} />;
    }
    return <img src={url} alt="" width={size} height={size} className="shrink-0" onError={() => setFailed(url)} />;
}

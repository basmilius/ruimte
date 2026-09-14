import type { ChatAttachmentUpload } from '@ruimte/contracts';
import { useUploadThumbnail } from '@/chat/thumbnails';

const BOX = 'h-14 w-14 rounded-lg border border-border';

/* An image the composer holds, drawn from its thumbnail; an empty box of the same size stands in while that is made. */
export function UploadThumb({ upload }: { upload: ChatAttachmentUpload }) {
    const url = useUploadThumbnail(upload);
    if (url === null) {
        return <span role="img" aria-label={upload.name} className={`block bg-surface-sunken ${BOX}`} />;
    }
    return <img src={url} alt={upload.name} className={`object-cover ${BOX}`} />;
}

import { VisualPageFrame } from '@adecore/agents-react/chat/ui';
import { Button, EmptyState, messageOf } from '@adecore/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readDesignPage } from '@/design/design-read';
import { useTransportStatus } from '@/transport/status';

type PageRead = { status: 'reading' } | { status: 'failed'; reason: string } | { status: 'ready'; page: () => Promise<string> };

interface DesignPageFrameProps {
    endpointId: string;
    folder: string;
    file: string;
}

/*
 * Reads a page before its frame opens: the frame says only that a page failed, and stays failed. Here a
 * person sees why and can read it again, and a read a dropped connection failed starts over by itself.
 */
export function DesignPageFrame({ endpointId, folder, file }: DesignPageFrameProps) {
    const { t } = useTranslation('shell');
    const connection = useTransportStatus();
    const [read, setRead] = useState<PageRead>({ status: 'reading' });
    const [attempt, setAttempt] = useState(0);
    const [seenConnection, setSeenConnection] = useState(connection);

    if (connection !== seenConnection) {
        setSeenConnection(connection);

        if (connection === 'open' && read.status === 'failed') {
            setRead({ status: 'reading' });
            setAttempt(attempt + 1);
        }
    }

    useEffect(() => {
        let current = true;

        readDesignPage(endpointId, folder, file).then(
            (html) => {
                if (current) {
                    setRead({ status: 'ready', page: () => Promise.resolve(html) });
                }
            },
            (error: unknown) => {
                if (current) {
                    setRead({ status: 'failed', reason: messageOf(error) });
                }
            }
        );

        return () => {
            current = false;
        };
    }, [endpointId, folder, file, attempt]);

    if (read.status === 'reading') {
        return <div className="progress-line absolute inset-x-0 top-0 z-10" role="progressbar" aria-label={t('design.loading')} />;
    }

    if (read.status === 'failed') {
        return (
            <EmptyState
                icon={TriangleAlert}
                className="h-full select-text"
                action={
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            setRead({ status: 'reading' });
                            setAttempt(attempt + 1);
                        }}
                    >
                        {t('design.readAgain')}
                    </Button>
                }
            >
                {t('design.pageFailed', { name: file, reason: read.reason })}
            </EmptyState>
        );
    }

    return <VisualPageFrame page={read.page} title={file} fill />;
}

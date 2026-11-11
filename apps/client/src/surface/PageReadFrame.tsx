import { VisualPageFrame } from '@adecore/agents-react/chat/ui';
import { Button, EmptyState, messageOf } from '@adecore/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTransportStatus } from '@/transport/status';

type PageRead = { status: 'reading' } | { status: 'failed'; reason: string } | { status: 'ready'; page: () => Promise<string> };

interface PageReadFrameProps {
    read: () => Promise<string>;
    /* Another value reads the page again; `read` itself is only called, never compared. */
    readKey: string;
    title: string;
    /* The page as the failure names it. */
    name: string;
    readingLabel: string;
    /* Grows the frame with its page; without it the page fills the positioned box it sits in. */
    auto?: boolean;
}

/*
 * Reads an agent's page before its frame opens: the frame says only that a page failed, and stays failed.
 * Here a person sees why and can read it again, and a read a dropped connection failed starts over by
 * itself. The frame opens its bridge again for every new `page`, so it gets the read HTML once, held in state.
 */
export function PageReadFrame({ read, readKey, title, name, readingLabel, auto = false }: PageReadFrameProps) {
    const { t } = useTranslation('shell');
    const connection = useTransportStatus();
    const [state, setState] = useState<PageRead>({ status: 'reading' });
    const [attempt, setAttempt] = useState(0);
    const [seenConnection, setSeenConnection] = useState(connection);
    const readPage = useEffectEvent(read);

    if (connection !== seenConnection) {
        setSeenConnection(connection);

        if (connection === 'open' && state.status === 'failed') {
            setState({ status: 'reading' });
            setAttempt(attempt + 1);
        }
    }

    useEffect(() => {
        let current = true;

        readPage().then(
            (html) => {
                if (current) {
                    setState({ status: 'ready', page: () => Promise.resolve(html) });
                }
            },
            (error: unknown) => {
                if (current) {
                    setState({ status: 'failed', reason: messageOf(error) });
                }
            }
        );

        return () => {
            current = false;
        };
    }, [readKey, attempt]);

    const body = () => {
        if (state.status === 'reading') {
            return <div className="progress-line absolute inset-x-0 top-0 z-10" role="progressbar" aria-label={readingLabel} />;
        }

        if (state.status === 'failed') {
            return (
                <EmptyState
                    icon={TriangleAlert}
                    className="h-full select-text"
                    action={
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                setState({ status: 'reading' });
                                setAttempt(attempt + 1);
                            }}
                        >
                            {t('pageFrame.readAgain')}
                        </Button>
                    }
                >
                    {t('pageFrame.failed', { name, reason: state.reason })}
                </EmptyState>
            );
        }

        return <VisualPageFrame page={state.page} title={title} fill={!auto} />;
    };

    if (auto) {
        return <div className="relative">{body()}</div>;
    }

    return body();
}

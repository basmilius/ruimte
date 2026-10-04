import { Markdown } from '@ruimte/agents-react/chat/ui/Markdown';
import type { SignatureViewModel } from './signature-model';

/* The signature with the parameter being typed underlined, and what is said about that parameter below it. */
export function SignatureCard({ model }: { model: SignatureViewModel }) {
    const { label, active } = model;
    const documentation = model.parameterDocumentation !== '' ? model.parameterDocumentation : model.documentation;

    return (
        <div className="flex w-max max-w-[min(560px,calc(100vw-16px))] min-w-[240px] flex-col divide-y divide-border">
            <div className="px-3 py-2 font-mono text-code break-words whitespace-pre-wrap text-text-muted">
                {active === null ? (
                    label
                ) : (
                    <>
                        {label.slice(0, active.start)}
                        <span className="font-semibold text-text underline decoration-2 underline-offset-2">{label.slice(active.start, active.end)}</span>
                        {label.slice(active.end)}
                    </>
                )}
                {model.count > 1 && (
                    <span className="ml-2 font-sans text-xs text-text-faint">
                        {model.index + 1}/{model.count}
                    </span>
                )}
            </div>
            {documentation !== '' && (
                <div className="flex items-baseline gap-1.5 px-3 py-2 text-xs text-text-muted select-text [&_.chat-markdown]:text-xs [&_.chat-markdown_p]:m-0">
                    {model.parameterName !== '' && model.parameterDocumentation !== '' && (
                        <>
                            <span className="shrink-0 font-semibold text-text">{model.parameterName}</span>
                            <span aria-hidden>·</span>
                        </>
                    )}
                    <div className="min-w-0">
                        <Markdown text={documentation} fileLinks={false} />
                    </div>
                </div>
            )}
        </div>
    );
}

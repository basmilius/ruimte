import { FADE_CLASS, isWhitespace, wordSegments } from './rehype-fade';

export function FadingWords({ text }: { text: string }) {
    return (
        <>
            {wordSegments(text).map((segment, index) =>
                isWhitespace(segment) ? (
                    segment
                ) : (
                    // Streaming appends words, so the index keeps existing fades from restarting.
                    <span key={index} className={FADE_CLASS}>
                        {segment}
                    </span>
                )
            )}
        </>
    );
}

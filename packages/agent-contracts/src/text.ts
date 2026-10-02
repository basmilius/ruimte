const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/*
 * The longest start of `text` that fits in `max` UTF-16 units, the measure a schema's `max` counts in,
 * cut only between characters as a person sees them. A cut between the halves of a surrogate pair
 * leaves a lone half, which JSON writes as an escape the iPhone app refuses along with its whole frame.
 */
export const clipText = (text: string, max: number): string => {
    if (text.length <= max) {
        return text;
    }
    let end = 0;
    for (const { segment } of graphemes.segment(text)) {
        if (end + segment.length > max) {
            break;
        }
        end += segment.length;
    }
    return text.slice(0, end);
};

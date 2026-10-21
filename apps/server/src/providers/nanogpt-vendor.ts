/*
 * Who made a model, for the picker to group by. NanoGPT's slugs name a publisher before the slash
 * (`z-ai/glm-5.3`), which is the truth for the maker and for a community fine-tune alike, so that is
 * what the group is. The same maker spells itself several ways (`deepseek` and `deepseek-ai`,
 * `TheDrummer` and `thedrummer`), so known ones are folded onto one name. A slug with no publisher
 * is placed by the family its name starts with, and by NanoGPT's own names, and is `Other` otherwise.
 */
const KNOWN: Record<string, string> = {
    'z-ai': 'Z.ai',
    thudm: 'Z.ai',
    qwen: 'Qwen',
    deepseek: 'DeepSeek',
    'deepseek-ai': 'DeepSeek',
    moonshotai: 'Moonshot AI',
    minimax: 'MiniMax',
    mistralai: 'Mistral AI',
    google: 'Google',
    'meta-llama': 'Meta',
    meta: 'Meta',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    'x-ai': 'xAI',
    nvidia: 'NVIDIA',
    xiaomi: 'Xiaomi',
    tencent: 'Tencent',
    bytedance: 'ByteDance',
    perplexity: 'Perplexity',
    'ibm-granite': 'IBM',
    liquid: 'Liquid AI',
    inception: 'Inception',
    poolside: 'Poolside',
    reka: 'Reka',
    nousresearch: 'Nous Research',
    'stepfun-ai': 'StepFun',
    inclusionai: 'inclusionAI',
    thedrummer: 'TheDrummer',
    sao10k: 'Sao10K',
    'eva-unit-01': 'EVA-UNIT-01',
    'prism-ml': 'PrismML',
    'huihui-ai': 'huihui-ai'
};

/* The first word of a slug without a publisher, which is the family and so the maker. */
const FAMILIES: Array<[RegExp, string]> = [
    [/^gemma/i, 'Google'],
    [/^qwen|^qvq/i, 'Qwen'],
    [/^deepseek/i, 'DeepSeek'],
    [/^(meta-)?llama/i, 'Meta'],
    [/^phi-/i, 'Microsoft'],
    [/^glm/i, 'Z.ai'],
    [/^kimi/i, 'Moonshot AI'],
    [/^minimax/i, 'MiniMax'],
    [/^longcat/i, 'Meituan'],
    [/^(auto-model|claw-|hermes-|nano-gpt)/i, 'NanoGPT']
];

const OTHER = 'Other';

export function nanoGptVendorOf(slug: string): string {
    const at = slug.indexOf('/');
    if (at > 0) {
        const publisher = slug.slice(0, at);
        return KNOWN[publisher.toLowerCase()] ?? publisher;
    }
    return FAMILIES.find(([pattern]) => pattern.test(slug))?.[1] ?? OTHER;
}

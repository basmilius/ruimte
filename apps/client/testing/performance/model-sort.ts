import { ModelInfoSchema } from '@ruimte/contracts';
import { modelsByVendor } from '../../node_modules/@adecore/agents-react/src/chat/logic/picker-entries';
import { median } from './bench';

const count = Number(process.env.BENCH_MODELS ?? 700);
const runs = Number(process.env.BENCH_RUNS ?? 9);
if (![count, runs].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('BENCH_MODELS and BENCH_RUNS must be positive integers');
}
const vendors = ['OpenAI', 'Anthropic', 'Google', 'DeepSeek', 'Qwen', 'Moonshot AI', 'Mistral', 'Meta', 'xAI', 'Microsoft', 'Cohere', 'Amazon', 'Z.ai'];
const models = Array.from({ length: count }, (_, index) =>
    ModelInfoSchema.parse({
        slug: `model-${index}`,
        name: `Model ${(index * 219) % count}`,
        legacy: false,
        isDefault: false,
        options: [],
        ...(index % 19 === 0 ? {} : { vendor: vendors[index % vendors.length] })
    })
);
const original = models.map((model) => model.slug).join(',');
const expected = [...models]
    .sort((left, right) => {
        if (left.vendor === undefined || right.vendor === undefined) {
            return left.vendor === right.vendor ? 0 : left.vendor === undefined ? 1 : -1;
        }
        return (
            left.vendor.localeCompare(right.vendor, undefined, { sensitivity: 'base' }) ||
            left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
        );
    })
    .map((model) => model.slug)
    .join(',');
const samples = [];
for (let run = -1; run < runs; run++) {
    const started = performance.now();
    const result = modelsByVendor(models);
    const ms = performance.now() - started;
    if (result.map((model) => model.slug).join(',') !== expected || models.map((model) => model.slug).join(',') !== original) {
        throw new Error('Model sorting changed its order or mutated the catalog');
    }
    if (run >= 0) {
        samples.push(ms);
    }
}
console.log(JSON.stringify({ benchmark: 'model-vendor-sort', count, runs, samples }, null, 2));
if (median(samples) > Number(process.env.BENCH_MAX_SORT_MS ?? Infinity)) {
    throw new Error('Model sorting exceeded its timing budget');
}

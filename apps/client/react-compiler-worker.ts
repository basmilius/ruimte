import { parentPort } from 'node:worker_threads';
import { compileWithBabel } from './react-compiler-babel.ts';

parentPort?.on('message', async ({ job, code, id }: { job: number; code: string; id: string }) => {
    try {
        parentPort?.postMessage({ job, ...(await compileWithBabel(code, id)) });
    } catch (error) {
        parentPort?.postMessage({ job, error: error instanceof Error ? error.message : String(error) });
    }
});

import { parseBrokerArgs } from './config.ts';
import { startBroker } from './server.ts';

let config;
try {
    config = parseBrokerArgs(process.argv.slice(2));
} catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
}

const running = startBroker(config);
const names = config.names.length > 0 ? config.names.join(', ') : 'any Host header';
console.log(`pulsar broker listening on ws://${config.host}:${running.port} (answers to ${names}${config.trustProxy ? ', behind a proxy' : ''})`);

const shutdown = (signal: string): void => {
    console.log(`pulsar broker received ${signal}, closing sockets`);
    void running.stop().then(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

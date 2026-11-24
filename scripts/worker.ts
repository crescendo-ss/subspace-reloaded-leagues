import { setTimeout } from 'node:timers/promises';
import { configuration, database } from '../src/runtime.ts';
import { demoClient } from '../src/demo.ts';
import { synchronize, zoneClient } from '../src/reloaded.ts';

const config = configuration();
const store = await database();
const client = config.demo ? demoClient : zoneClient(config);
const stop = new AbortController();
process.on('SIGTERM', () => stop.abort());
process.on('SIGINT', () => stop.abort());
while (!stop.signal.aborted) {
  try {
    await synchronize(store, config, client);
  } catch (error) {
    console.error('Fixture synchronization:', error);
  }
  await setTimeout(5000, undefined, { signal: stop.signal }).catch(() => {});
}
await store.close();

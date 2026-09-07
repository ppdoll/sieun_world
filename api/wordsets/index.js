import { makeWordSetsHandler } from '../_lib/wordsets-handler.mjs';
import { storeFromEnv } from '../_lib/github.mjs';

export default makeWordSetsHandler({
  store: storeFromEnv(),
  passcode: process.env.APP_PASSCODE || '',
});

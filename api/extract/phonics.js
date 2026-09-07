import { makePhonicsHandler } from '../_lib/handlers.mjs';
import { callModel, Anthropic } from '../_lib/claude.mjs';

export default makePhonicsHandler({
  callModel,
  Anthropic,
  passcode: process.env.APP_PASSCODE || '',
});

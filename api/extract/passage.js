import { makePassageHandler } from '../_lib/handlers.mjs';
import { callModel, Anthropic } from '../_lib/claude.mjs';

export default makePassageHandler({
  callModel,
  Anthropic,
  passcode: process.env.APP_PASSCODE || '',
});

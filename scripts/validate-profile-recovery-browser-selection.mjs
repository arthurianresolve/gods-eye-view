#!/usr/bin/env node
import { validateProfileRecoveryBrowserSelection } from './performance/profileRecoveryBrowserVersion.mjs';

const version = validateProfileRecoveryBrowserSelection({
  version: process.env.GEV_QA_PROFILE_RECOVERY_CHROME_VERSION,
  eventName: process.env.GITHUB_EVENT_NAME,
  validationMode: process.env.GEV_QA_VALIDATION_MODE,
  runner: process.env.GEV_QA_SELECTED_RUNNER,
  platform: process.platform,
});
console.log(
  JSON.stringify({
    selection: version ? 'exact-chrome-for-testing' : 'pinned-default',
    expectedVersion: version,
  }),
);

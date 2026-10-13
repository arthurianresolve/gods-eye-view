import { ESLint } from 'eslint';
import {
  CAPTURE_NO_UNDEF_CONFIG,
  CAPTURE_NO_UNDEF_FIXTURE_CONFIG,
  CAPTURE_NO_UNDEF_FILES,
} from './captureNoUndefConfig.mjs';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [CAPTURE_NO_UNDEF_CONFIG, CAPTURE_NO_UNDEF_FIXTURE_CONFIG],
});
const results = await eslint.lintFiles(CAPTURE_NO_UNDEF_FILES);
const formatter = await eslint.loadFormatter('stylish');
const output = formatter.format(results);
if (output) process.stderr.write(output);

const errors = results.reduce((total, result) => total + result.errorCount, 0);
if (errors > 0) process.exitCode = 1;
else
  process.stdout.write(
    `Capture harness no-undef: ${results.length} files passed.\n`,
  );

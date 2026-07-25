#!/usr/bin/env node
import { doctor, init } from '../src/commands.js';

const [, , command, ...argv] = process.argv;

const USAGE = `
sitecore-smarttable — install the SmartTable component into a SitecoreAI repo

  npx sitecore-smarttable init [options]
  npx sitecore-smarttable doctor

Options (init)
  --host=<name>   Rendering host from xmcloud.build.json. Repeatable, or
                  comma-separated. Required when more than one is enabled.
  --force         Overwrite an existing install.
  --dry-run       Report what would be written, change nothing.

Run from anywhere inside the repo; the CLI finds the root by walking up to
xmcloud.build.json.
`;

switch (command) {
  case 'init':
    init(argv);
    break;
  case 'doctor':
    doctor();
    break;
  case '--help':
  case '-h':
  case undefined:
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
}

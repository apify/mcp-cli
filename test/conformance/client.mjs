#!/usr/bin/env node

// Adapter that drives the mcpc CLI from the
// `@modelcontextprotocol/conformance` framework.
//
// The framework invokes this script with the test server URL appended as the
// last positional argument and sets `MCP_CONFORMANCE_SCENARIO` (plus an
// optional `MCP_CONFORMANCE_CONTEXT` JSON blob) in the environment.  Per
// scenario, we translate the expected behaviour into one or more mcpc
// sub-commands against a freshly-created session, then tear the session down
// again.
//
// Only a small set of scenarios is wired up today; unsupported ones exit
// non-zero so the framework records them as failures (track them in
// `test/conformance/expected-failures.yml` to keep CI green until coverage
// grows).

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scenario = process.env.MCP_CONFORMANCE_SCENARIO;
const serverUrl = process.argv[process.argv.length - 1];

if (!scenario) {
    console.error('MCP_CONFORMANCE_SCENARIO environment variable is not set');
    process.exit(1);
}
if (!serverUrl || !/^https?:\/\//i.test(serverUrl)) {
    console.error(`Missing or invalid server URL (got: ${serverUrl ?? ''})`);
    process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const mcpcBin = resolve(here, '..', '..', 'bin', 'mcpc');
const homeDir = await mkdtemp(`${tmpdir()}/mcpc-conformance-`);
const sessionName = `conformance-${process.pid}`;
const env = { ...process.env, MCPC_HOME_DIR: homeDir, MCPC_JSON: '1' };

function runMcpc(args) {
    return new Promise((res, rej) => {
        const child = spawn(mcpcBin, args, { env, stdio: 'inherit' });
        child.once('error', rej);
        child.once('exit', (code) => {
            if (code === 0) res();
            else rej(new Error(`mcpc ${args.join(' ')} exited with code ${code}`));
        });
    });
}

async function cleanup() {
    try {
        await runMcpc([`@${sessionName}`, 'close']);
    } catch {
        // Best effort — the session may never have been created.
    }
    await rm(homeDir, { recursive: true, force: true }).catch(() => {});
}

async function main() {
    switch (scenario) {
        case 'initialize':
            // Connecting triggers the full MCP initialize handshake via the
            // bridge process.  That is all the conformance server needs to
            // observe for this scenario.
            await runMcpc(['connect', serverUrl, `@${sessionName}`]);
            return;

        case 'tools-call':
            await runMcpc(['connect', serverUrl, `@${sessionName}`]);
            await runMcpc([`@${sessionName}`, 'tools-list']);
            return;

        default:
            console.error(`Scenario not implemented by mcpc conformance adapter: ${scenario}`);
            process.exit(1);
    }
}

try {
    await main();
} catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
} finally {
    await cleanup();
}

import { defineConfig } from '@flue/cli/config';

/**
 * Build-time config only (target, root, output). Provider/model
 * registration is a runtime concern and lives in code that reads
 * process.env — never hardcode API keys here.
 *
 * `target: "node"` matches Lambda's Node.js runtime and lets
 * `flue run` / `flue dev` work locally without the flag.
 */
export default defineConfig({ target: 'node' });

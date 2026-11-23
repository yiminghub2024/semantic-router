#!/usr/bin/env node
import { Command } from 'commander';
import { commands } from './src/commands.js';

const root = new Command()
  .name('jev-duo')
  .description('Jev / System Duo agent');
commands(root);
try {
  await root.parseAsync();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}

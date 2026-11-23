import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ask, decide, loadMedia } from './agent.js';
import { Archive } from './archive.js';
import { settings } from './config.js';

function serviceOptions(cmd) {
  return cmd
    .option(
      '--backend <name>',
      'vllm, typesafe or local',
      process.env.JEV_BACKEND || 'vllm',
    )
    .option(
      '--config <file>',
      'Path to the model catalog',
      process.env.JEV_CONFIG,
    );
}
function withArchive() {
  return new Archive(process.env.JEV_DATA_DIR || join(homedir(), '.jev-duo'));
}

export function commands(root) {
  const chat = root
    .command('ask <prompt>')
    .description('Answer one turn using isolated history');
  serviceOptions(chat)
    .requiredOption('--session <id>', 'Conversation to resume')
    .option('--file <path...>', 'Attach local images or videos to this turn')
    .option('--model <alias>', 'Select a compatible catalog model')
    .action(async (prompt, opts) => {
      const config = settings(opts.backend, opts.config);
      const media = loadMedia(opts.file || []);
      const archive = withArchive();
      try {
        const result = await ask(
          config,
          archive,
          opts.session,
          prompt,
          media,
          opts.model,
        );
        console.error(
          '[' + opts.backend + '/' + result.route + '] ' + result.model,
        );
        console.log(result.reply);
      } finally {
        archive.close();
      }
    });

  serviceOptions(
    root
      .command('decide <file>')
      .description('Ask typed questions from a JSON file'),
  )
    .option('--file <path...>', 'Attach files to this decision')
    .option('--session <id>', 'Archive the decision for later conversation')
    .action(async (file, opts) => {
      const config = settings(opts.backend, opts.config, false);
      const body = JSON.parse(
        readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
      );
      if (
        body.state === undefined ||
        !body.questions ||
        typeof body.questions !== 'object' ||
        Array.isArray(body.questions) ||
        !Object.keys(body.questions).length
      )
        throw new Error('Provide state and a non-empty questions object');
      const media = loadMedia(opts.file || []);
      const archive = opts.session ? withArchive() : undefined;
      try {
        const seq = archive
          ? (archive.history(opts.session).at(-1)?.seq ?? 0) + 1
          : 0;
        const answers = await decide(
          config.decision,
          body.state,
          body.questions,
          media,
          opts.backend,
        );
        const reply = JSON.stringify(answers, null, 2);
        archive?.append({
          session: opts.session,
          seq,
          prompt: JSON.stringify({
            state: body.state,
            questions: body.questions,
          }),
          reply,
          backend: opts.backend,
          model: config.decision.model,
          media,
        });
        console.log(reply);
      } finally {
        archive?.close();
      }
    });

  root
    .command('history')
    .description('Show the latest 64 archived turns and attachment references')
    .requiredOption('--session <id>', 'Conversation to inspect')
    .action((opts) => {
      const archive = withArchive();
      try {
        console.log(JSON.stringify(archive.history(opts.session), null, 2));
      } finally {
        archive.close();
      }
    });
}

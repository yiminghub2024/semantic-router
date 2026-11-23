const descriptor = {
  name: 'jev',
  description: 'Run the Jev Duo agent',
  hasSubcommands: true,
};

export default {
  id: 'jev-duo-agent',
  name: 'Jev Duo Agent',
  register(api) {
    api.registerCli(
      async ({ program }) => {
        const { commands } = await import('./src/commands.js');
        commands(
          program.command(descriptor.name).description(descriptor.description),
        );
      },
      { descriptors: [descriptor] },
    );
  },
};

#!/usr/bin/env node
import { KnowledgeProvider } from '../src/index.js';

const USAGE = `Usage: doodle <command> [project] [options]
Commands:
  register <repository-path> [--id <project-id>]
  list
  unregister <project-id>
  sync <project-id> [--since <git-ref>] [--rebuild]
  current <project-id>
  changes <project-id> [--since <git-ref>]
  context <project-id> --task <text>
Options: --json (machine-readable output); --id may replace the project-id positional argument.`;

class UsageError extends Error {}

function parse(args) {
  const [command, ...rest] = args;
  if (!['register', 'list', 'unregister', 'sync', 'current', 'changes', 'context'].includes(command)) {
    throw new UsageError(command ? `Unknown command: ${command}` : 'Missing command.');
  }
  const options = {};
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--json' || token === '--rebuild') {
      if (options[token]) throw new UsageError(`Duplicate option: ${token}`);
      options[token] = true;
    } else if (['--id', '--since', '--task'].includes(token)) {
      const value = rest[++index];
      if (!value || value.startsWith('--')) throw new UsageError(`Missing value for ${token}.`);
      if (options[token] !== undefined) throw new UsageError(`Duplicate option: ${token}`);
      options[token] = value;
    } else if (token.startsWith('-')) {
      throw new UsageError(`Unknown option: ${token}`);
    } else {
      positional.push(token);
    }
  }
  const permitted = {
    register: ['--id', '--json'],
    list: ['--json'],
    unregister: ['--id', '--json'],
    sync: ['--id', '--since', '--rebuild', '--json'],
    current: ['--id', '--json'],
    changes: ['--id', '--since', '--json'],
    context: ['--id', '--task', '--json'],
  }[command];
  for (const option of Object.keys(options)) {
    if (!permitted.includes(option)) throw new UsageError(`${option} is not valid for ${command}.`);
  }
  if (command === 'list') {
    if (positional.length !== 0) throw new UsageError('list takes no project argument.');
  } else if (command === 'register') {
    if (positional.length !== 1) throw new UsageError('register requires one repository path.');
  } else if (positional.length + Number(options['--id'] !== undefined) !== 1) {
    throw new UsageError(`${command} requires one project ID.`);
  }
  if (command === 'context' && !options['--task']) throw new UsageError('context requires --task <text>.');
  return { command, project: command === 'register' ? positional[0] : options['--id'] ?? positional[0], options };
}

function execute(provider, { command, project, options }) {
  switch (command) {
    case 'register': return provider.register(project, { id: options['--id'] });
    case 'list': return provider.list();
    case 'unregister': return provider.unregister(project);
    case 'sync': return provider.sync(project, { since: options['--since'], rebuild: options['--rebuild'] });
    case 'current': return provider.getCurrent(project);
    case 'changes': return provider.getChanges(project, { since: options['--since'] });
    case 'context': return provider.getContext(project, options['--task']);
    default: throw new UsageError(`Unknown command: ${command}`);
  }
}

function human(command, value) {
  switch (command) {
    case 'register': return `Registered ${value.id}: ${value.path}`;
    case 'list': return value.projects.length
      ? value.projects.map((project) => `${project.id}: ${project.path}`).join('\n')
      : 'No projects registered.';
    case 'unregister': return `Unregistered ${value.id}.`;
    case 'sync': return `Synced ${value.projectId}\nCommitted HEAD: ${value.current.repository.head}\nWorking tree: ${describeWorkingTree(value.current.workingTree)}\nChanges base: ${value.changes.base}\nChanges head: ${value.changes.head}\nDecisions: ${value.decisions.decisions.length}`;
    case 'current': return `Project: ${value.projectId}\nBranch: ${value.repository.branch}\nCommitted HEAD: ${value.repository.head}\nCommitted files: ${value.repository.committed.length}\nWorking tree: ${describeWorkingTree(value.workingTree)}`;
    case 'changes': return `Project: ${value.projectId}\nBase: ${value.base}\nHead: ${value.head}\nCommits: ${value.commits.length}\nChanged files: ${value.files.length}`;
    case 'context': return `Project: ${value.project.id}\nTask: ${value.task.text}\nCommitted HEAD: ${value.currentState.repository.head}\nWorking tree: ${describeWorkingTree(value.workingTree)}\nRelevant decisions: ${value.relevantDecisions.map((decision) => decision.path).join(', ') || 'none'}\nWarnings: ${value.warnings.length}`;
    default: throw new UsageError(`Unknown command: ${command}`);
  }
}

function describeWorkingTree(tree) {
  return Object.entries(tree)
    .map(([state, paths]) => `${state} ${paths.length}`)
    .join(', ');
}

try {
  const request = parse(process.argv.slice(2));
  const value = execute(new KnowledgeProvider(), request);
  process.stdout.write(`${request.options['--json'] ? JSON.stringify(value) : human(request.command, value)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  if (error instanceof AggregateError) {
    for (const cause of error.errors) {
      process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    }
  }
  if (error instanceof UsageError) process.stderr.write(`${USAGE}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}

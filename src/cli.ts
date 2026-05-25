#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

type ProxyKey = 'deepseek' | 'qwen' | 'kimi';

interface ProxyDefinition {
  key: ProxyKey;
  aliases: string[];
  name: string;
  repo: string;
  dir: string;
  port: number;
}

const root = process.cwd();
const sourcesDir = path.join(root, 'sources');

const proxies: ProxyDefinition[] = [
  {
    key: 'deepseek',
    aliases: ['deeps', 'deepsproxy', 'deepseek'],
    name: 'DeepSeek',
    repo: 'https://github.com/pedrofariasx/deepsproxy.git',
    dir: 'deepsproxy',
    port: 3101
  },
  {
    key: 'qwen',
    aliases: ['qwen', 'qwenproxy'],
    name: 'Qwen',
    repo: 'https://github.com/pedrofariasx/qwenproxy.git',
    dir: 'qwenproxy',
    port: 3102
  },
  {
    key: 'kimi',
    aliases: ['kimi', 'kimiproxy'],
    name: 'Kimi',
    repo: 'https://github.com/pedrofariasx/kimiproxy.git',
    dir: 'kimiproxy',
    port: 3103
  }
];

function printHelp(): void {
  console.log([
    'AtlasRouter CLI',
    '',
    'Usage:',
    '  atlas get <deepseek|qwen|kimi|all> [--no-install]',
    '  atlas list',
    '  atlas status',
    '  atlas login <deepseek|qwen|kimi>',
    '  atlas start',
    '',
    'Examples:',
    '  atlas get kimi',
    '  atlas get deepseek qwen',
    '  atlas get all',
    '  atlas login qwen',
    '  atlas start'
  ].join('\n'));
}

function run(command: string, args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32'
  });
  return result.status === 0;
}

function resolveProxy(value: string): ProxyDefinition | null {
  const normalized = value.toLowerCase();
  return proxies.find((proxy) => proxy.aliases.includes(normalized)) ?? null;
}

function selected(values: string[]): ProxyDefinition[] {
  if (values.length === 0) {
    console.error('Missing proxy name.');
    process.exit(1);
  }

  if (values.includes('all')) return proxies;

  const resolved = values.map((value) => {
    const proxy = resolveProxy(value);
    if (!proxy) {
      console.error(`Unknown proxy: ${value}`);
      process.exit(1);
    }
    return proxy;
  });

  return [...new Map(resolved.map((proxy) => [proxy.key, proxy])).values()];
}

function proxyPath(proxy: ProxyDefinition): string {
  return path.join(sourcesDir, proxy.dir);
}

function isInstalled(proxy: ProxyDefinition): boolean {
  return existsSync(path.join(proxyPath(proxy), 'package.json'));
}

function installDependencies(proxy: ProxyDefinition): void {
  console.log(`Installing dependencies for ${proxy.name}...`);
  run('npm', ['install'], proxyPath(proxy));
}

function getProxy(proxy: ProxyDefinition, install: boolean): void {
  mkdirSync(sourcesDir, { recursive: true });

  if (isInstalled(proxy)) {
    console.log(`${proxy.name} already exists at sources/${proxy.dir}`);
    if (install) installDependencies(proxy);
    return;
  }

  if (existsSync(proxyPath(proxy))) {
    console.error(`sources/${proxy.dir} exists but is not a valid proxy checkout.`);
    process.exit(1);
  }

  console.log(`Cloning ${proxy.name} from ${proxy.repo}...`);
  run('git', ['clone', proxy.repo, proxyPath(proxy)]);

  if (install) installDependencies(proxy);
}

function listProxies(): void {
  for (const proxy of proxies) {
    console.log(`${proxy.key.padEnd(8)} ${isInstalled(proxy) ? 'installed' : 'missing'}  port ${proxy.port}  sources/${proxy.dir}`);
  }
}

function loginProxy(proxy: ProxyDefinition): void {
  if (!isInstalled(proxy)) {
    console.error(`${proxy.name} is not installed. Run: atlas get ${proxy.key}`);
    process.exit(1);
  }

  run('npm', ['run', 'login'], proxyPath(proxy));
}

function startAtlas(): void {
  run('npm', ['run', 'dev'], root);
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'get') {
    if (!commandExists('git')) {
      console.error('Git is required to download proxies.');
      process.exit(1);
    }
    const install = !args.includes('--no-install');
    const names = args.filter((arg) => arg !== '--no-install');
    for (const proxy of selected(names)) getProxy(proxy, install);
    return;
  }

  if (command === 'list' || command === 'status') {
    listProxies();
    return;
  }

  if (command === 'login') {
    const proxy = resolveProxy(args[0] ?? '');
    if (!proxy) {
      console.error('Choose one proxy: deepseek, qwen, or kimi.');
      process.exit(1);
    }
    loginProxy(proxy);
    return;
  }

  if (command === 'start') {
    startAtlas();
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main();

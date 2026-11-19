import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const checks = [
  {
    name: 'Type-check',
    command: 'npm',
    args: ['run', 'type-check'],
    skip: args.has('--skip-type-check'),
  },
  {
    name: 'Testes',
    command: 'npm',
    args: ['test'],
    skip: args.has('--skip-tests'),
  },
  {
    name: 'Snyk',
    command: 'npm',
    args: ['run', 'security:snyk'],
    skip: args.has('--skip-snyk'),
  },
  {
    name: 'SonarQube',
    command: 'npm',
    args: ['run', 'sonar'],
    skip: !args.has('--sonar'),
  },
];

const results = [];

for (const check of checks) {
  if (check.skip) {
    results.push({ name: check.name, status: 'SKIPPED' });
    continue;
  }

  console.log(`\n▶ ${check.name}`);
  const result = spawnSync(check.command, check.args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const status = result.status === 0 ? 'PASSED' : 'FAILED';
  results.push({ name: check.name, status });

  if (status === 'FAILED') {
    console.error(`\n✖ ${check.name} falhou.`);
    break;
  }
}

console.log('\nCode review summary:');
for (const result of results) {
  console.log(`${result.status === 'PASSED' ? '✔' : result.status === 'SKIPPED' ? '○' : '✖'} ${result.name}: ${result.status}`);
}

if (results.some(({ status }) => status === 'FAILED')) {
  process.exitCode = 1;
}

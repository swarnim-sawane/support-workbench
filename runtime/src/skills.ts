import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { EngineSkillInfo } from './types.js';

const SKILL_FILENAMES = ['SKILL.md', 'skill.md'];

function parseFrontmatterValue(source: string, key: string): string | null {
  const match = source.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim() ?? null;
}

function currentHomeDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? homedir();
}

function listSkillRoots(cwd: string): string[] {
  return [
    join(cwd, '.agents', 'skills'),
    join(cwd, '.codex', 'skills'),
    join(currentHomeDir(), '.agents', 'skills'),
    join(currentHomeDir(), '.codex', 'skills')
  ].filter((path, index, all) => all.indexOf(path) === index);
}

export function discoverSkills(cwd: string): EngineSkillInfo[] {
  const discovered: EngineSkillInfo[] = [];

  for (const root of listSkillRoots(cwd)) {
    if (!existsSync(root)) {
      continue;
    }

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const directory = resolve(root, entry.name);
      const skillFileName = SKILL_FILENAMES.find((name) => existsSync(join(directory, name)));
      if (!skillFileName) {
        continue;
      }

      const path = join(directory, skillFileName);
      const content = readFileSync(path, 'utf8');
      discovered.push({
        name: parseFrontmatterValue(content, 'name') ?? entry.name,
        description: parseFrontmatterValue(content, 'description') ?? 'Local skill',
        path
      });
    }
  }

  return discovered.sort((left, right) => left.name.localeCompare(right.name));
}

export function readSkill(cwd: string, command: string): {
  skill: EngineSkillInfo;
  content: string;
} | null {
  const normalized = command.trim().toLowerCase();
  const skill = discoverSkills(cwd).find((item) => item.name.toLowerCase() === normalized);
  if (!skill) {
    return null;
  }

  return {
    skill,
    content: readFileSync(skill.path, 'utf8')
  };
}

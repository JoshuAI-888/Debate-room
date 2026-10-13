import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, BRAINS_DIR, AGENTS_DIR } from './env.mjs';
export const REGISTRY = path.join(REPO_ROOT, 'characters', 'registry.json');
export const BRAIN_FILES = ['_hot.md', 'frameworks.md', 'positions.md', 'principles.md', 'voice.md', 'stories.md', 'sources.md'];
export function validateCharacter(s) {
  const errors = [];
  for (const field of ['key', 'slug']) if (!/^[a-z][a-z0-9-]{0,63}$/.test(s[field] || '')) errors.push(`Invalid ${field}`);
  for (const field of ['name', 'short', 'initials', 'pillar', 'question', 'dimension']) if (typeof s[field] !== 'string' || !s[field].trim()) errors.push(`Missing ${field}`);
  if (!['role', 'public-person', 'fictional'].includes(s.kind)) errors.push('Invalid kind');
  if (!['draft', 'ready'].includes(s.status)) errors.push('Invalid status');
  if (typeof s.enabled !== 'boolean') errors.push('enabled must be boolean');
  if (s.enabled && s.status !== 'ready') errors.push('Draft characters cannot be enabled');
  if (s.avatar && !/^\/portraits\/[a-z0-9-]+\.svg$/.test(s.avatar)) errors.push('Invalid avatar path');
  if (errors.length) return errors;
  for (const f of BRAIN_FILES) {
    const file = path.join(BRAINS_DIR, s.slug, f);
    if (!fs.existsSync(file)) errors.push(`Missing ${f}`);
    else if (s.status === 'ready' && /TODO|\[RESEARCH REQUIRED\]/.test(fs.readFileSync(file, 'utf8'))) errors.push(`Unfinished research in ${f}`);
  }
  if (!fs.existsSync(path.join(AGENTS_DIR, `council-${s.key}.md`))) errors.push('Missing agent');
  return errors;
}
export function loadCharacters() {
  const entries = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  if (!Array.isArray(entries) || !entries.length) throw new Error('Character registry must be a nonempty array');
  const keys = new Set(), slugs = new Set();
  for (const s of entries) {
    if (keys.has(s.key) || slugs.has(s.slug)) throw new Error(`Duplicate character: ${s.key}`);
    keys.add(s.key); slugs.add(s.slug);
    const errors = validateCharacter(s);
    if (errors.length) throw new Error(`${s.key}: ${errors.join('; ')}`);
  }
  if (!entries.some(s => s.enabled)) throw new Error('Enable at least one ready character');
  return entries;
}

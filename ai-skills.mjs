import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const aiSkillNames = [
  'travel-plan-foundation',
  'itinerary-timeline',
  'walkable-map-routing',
  'travel-record-writing',
  'trip-photo-album',
]

const skillsRoot = fileURLToPath(new URL('./.github/skills/', import.meta.url))
const maxSkillCharacters = 12000

function stripFrontmatter(text) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return match ? text.slice(match[0].length) : text
}

let skillsPromise

export function loadAiSkills() {
  skillsPromise ??= Promise.all(aiSkillNames.map(async (name) => {
    const raw = await readFile(join(skillsRoot, name, 'SKILL.md'), 'utf8')
    return `## Skill: ${name}\n\n${stripFrontmatter(raw).trim().slice(0, maxSkillCharacters)}`
  })).then((sections) => sections.join('\n\n'))
  return skillsPromise
}

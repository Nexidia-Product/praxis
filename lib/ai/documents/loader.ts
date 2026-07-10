/**
 * Load an active document skill for generation.
 *
 * Thin wrapper over DocumentSkillRepository.getActive so the API route
 * and any future callers get a single, well-messaged failure when a
 * skill key isn't seeded / activated yet.
 */

import { DocumentSkillRepository, type DocumentSkill } from "@/lib/db";

export async function loadSkill(key: string): Promise<DocumentSkill> {
  const skill = await DocumentSkillRepository.getActive(key);
  if (!skill) {
    throw new Error(
      `No active document skill for key "${key}". Seed it with ` +
        "`npm run seed:document-skills`, or activate a version in the " +
        "authoring UI.",
    );
  }
  return skill;
}

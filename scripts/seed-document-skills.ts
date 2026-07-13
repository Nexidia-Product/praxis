/**
 * Seed / upsert the starter document skills (currently: PRFAQ).
 *
 * Skills are the authored prompt library the document generator reads
 * (lib/ai/documents). This script publishes the built-in starter set so
 * a fresh environment can generate a PRFAQ from a project without anyone
 * hand-authoring a skill first. Re-running supersedes the active version
 * of each key (deactivate -> insert next version), so edits here roll
 * forward without losing history.
 *
 * Run with:
 *   npm run seed:document-skills
 *
 * Prereqs: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in
 * .env.local (the same service-role access the app uses), and migration
 * 0014 applied.
 */

import {
  DocumentSkillRepository,
  type CreateDocumentSkillInput,
} from "../lib/db";

const PRFAQ: CreateDocumentSkillInput = {
  key: "prfaq",
  name: "PRFAQ",
  // Placeholders resolve from the inputs below. Kept generic so the
  // project name carries any "Dashboard"/feature specifics.
  title_pattern: "PRFAQ — {feature_name}",
  // null -> falls back to settings.ai_config.document_model_id (Sonnet).
  model_id: null,
  instructions: `You are a product manager writing a PRFAQ for a NICE executive audience.

Length & tone:
- The whole document must fit 2-3 pages. Be ruthless about brevity.
- Lead with the customer/business outcome and impact, not implementation detail.
- Executive tone: plain, confident, active voice; short paragraphs; no jargon and no exhaustive lists.

Grounding:
- Innovation approach: take an idea, build a working prototype to prove the concept, then hand the proven concept to R&D to implement into the product.
- Write using ONLY the information in the input blocks and the product context. Do NOT invent capabilities, metrics, customers, quotes, data sources, dates, or scope that are not supported by the input.
- The richer inputs (tasks, key findings, decisions, the originating idea) are grounding material — synthesize them into the executive's language; do NOT restate them item by item.
- When a section, or a specific point, has no supporting information, write "To be determined" rather than guessing.
- Follow the section outline and the length limit stated in each section's guidance exactly.`,
  product_profile: `The core product is Automated Insights — it transforms unstructured conversational data into AI-ready intelligence presented in real-time dashboards. It provides an overall operational-effectiveness assessment for contact centers through complex analysis of interactions, across four key areas, each with its own dashboard:
- Cost-to-Serve analysis — common cost-to-serve metrics and optimization opportunities.
- Customer Experience analysis — common CX metrics and optimization opportunities.
- Revenue analysis — revenue and retention performance and optimization opportunities.
- Compliance analysis — contact-center compliance performance and gap reduction.
Each area supports drill-down on key metrics. Automated Insights is a growing product with frequent new initiatives.`,
  // Add a gold-standard PRFAQ here to few-shot future generations. Left
  // null on seed so no single feature's content biases every document.
  example: null,
  inputs: {
    feature_name: {
      source: "project.name",
      label: "Feature name",
      required: true,
    },
    summary: {
      source: "project.description",
      label: "Summary of the innovation",
      required: true,
    },
    application_product: {
      source: "project.application_product",
      label: "Product this belongs to",
      required: false,
    },
    definition_of_done: {
      source: "project.definition_of_done",
      label: "Definition of done (acceptance criteria)",
      required: false,
    },
    stakeholders: {
      source: "project.primary_stakeholders",
      label: "Primary stakeholders",
      required: false,
      transform: "list",
    },
    start_date: {
      source: "project.roadmap_timeline_start",
      label: "Planned start date",
      required: false,
    },
    target_date: {
      // A real project date; to_quarter turns it into "Q2 2026" in code
      // so every occurrence in the document is identical by construction.
      source: "project.target_date",
      label: "Target date for prototype completion and R&D handover",
      required: true,
      transform: "to_quarter",
    },
    // Grounding sources — formatted from structured data by the
    // generator. All optional: a sparse project still produces a doc,
    // and ungrounded sections resolve to "To be determined".
    outcomes: {
      kind: "outcomes",
      label: "Intended outcomes",
      required: false,
    },
    originating_idea: {
      kind: "originating_idea",
      label: "Originating idea (problem, urgency, stakeholders)",
      required: false,
    },
    tasks: {
      kind: "tasks",
      label: "Project tasks (work breakdown)",
      required: false,
    },
    task_findings: {
      kind: "task_findings",
      label: "Key findings recorded on tasks",
      required: false,
    },
    decisions: {
      kind: "decisions",
      label: "Decision log",
      required: false,
    },
  },
  outline: [
    {
      heading: "Press Release",
      style: "Heading1",
      guidance:
        "Two short paragraphs, 120 words maximum total. Open with 'FOR IMMEDIATE RELEASE — {target_date}' then a one-sentence headline. State what it is, the business outcome it drives, the initial scope, and that the prototype hands off to R&D in {target_date}. Executive tone; no implementation detail, no feature enumeration, no quotes.",
    },
    {
      heading: "Frequently Asked Questions",
      style: "Heading1",
      questions: [
        "What is the {feature_name}?",
        "Why is this needed?",
        "Who is this for?",
        "How does it work?",
        "What insights does it provide?",
        "What data sources are used now and later?",
        "How does it integrate with existing dashboards?",
      ],
      guidance:
        "One numbered sub-heading per question. Answer each in 1-2 sentences maximum, grounded strictly in the input. For data sources, name only sources present in the summary or task findings; otherwise 'To be determined'. No sub-bullets.",
    },
  ],
  version: 1,
  is_active: true,
};

async function publish(skill: CreateDocumentSkillInput): Promise<void> {
  const existing = await DocumentSkillRepository.getActive(skill.key);
  const version = existing ? existing.version + 1 : 1;
  if (existing) await DocumentSkillRepository.deactivate(skill.key);
  const created = await DocumentSkillRepository.create({ ...skill, version });
  console.log(
    `Published ${created.key} v${created.version} (id ${created.id})` +
      (existing ? ` — superseded v${existing.version}` : ""),
  );
}

async function main(): Promise<void> {
  await publish(PRFAQ);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

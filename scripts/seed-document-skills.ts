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
  instructions: `You are a product manager experienced with creating PRFAQ-format documents that describe new product innovations.

The innovation approach: take an idea, build a working prototype to prove the concept, then hand the proven concept to R&D to implement into the product.

Write the PRFAQ for the innovation described in the input. Follow the section outline exactly, in order. Be concrete and calibrated. Do not invent metrics, customers, quotes, or dates that are not supported by the input or the product context.`,
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
      label: "Summary of the new product innovation",
      required: true,
    },
    target_date: {
      // A real project date; to_quarter turns it into "Q2 2026" in code
      // so every occurrence in the document is identical by construction.
      source: "project.target_date",
      label: "Target date for prototype completion and R&D handover",
      required: true,
      transform: "to_quarter",
    },
  },
  outline: [
    {
      heading: "Press Release",
      style: "Heading1",
      guidance:
        "A single narrative. Open with 'FOR IMMEDIATE RELEASE — {target_date}' followed by a headline. Then 2-3 paragraphs derived from the summary: what the innovation is, the problem/impact it addresses across customer experience, cost-to-serve, revenue, and compliance, the initial data scope, and that the prototype hands off to R&D in {target_date}. No leader or customer quotes.",
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
        "One numbered sub-heading per question, in order, each with a 1-3 sentence answer grounded in the summary and product context.",
    },
    {
      heading: "MVP Scope & Assumptions",
      style: "Heading1",
      guidance:
        "What is in scope for the prototype versus deferred, and the key assumptions (data quality, language coverage, level of granularity).",
    },
    {
      heading: "MVP Success Criteria",
      style: "Heading1",
      format: "bullets",
      guidance:
        "3-4 measurable criteria (e.g. detection precision, correlation of the score to measurable outcomes, adoption/engagement).",
    },
    {
      heading: "Privacy, Ethics & Governance",
      style: "Heading1",
      guidance:
        "Explainability of model outputs, exclusion of protected attributes, access controls for sensitive insights, model-drift monitoring, and a supportive-not-punitive framing for any people-level insight.",
    },
    {
      heading: "Roadmap",
      style: "Heading1",
      guidance:
        "A short timeline anchored on {target_date} for prototype and R&D handoff, then near-term and later phases extrapolated from the future-enhancement hints in the summary.",
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

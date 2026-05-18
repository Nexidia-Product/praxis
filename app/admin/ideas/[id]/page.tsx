/**
 * Single idea detail / review page (Section 5.18).
 *
 * Shows the full submission, plus controls for the reviewer:
 *   - Status workflow: Approve / Reject / Mark Under Review.
 *   - Admin comments: free-form notes saved to the idea record.
 *   - AI Overlap Check: deferred to Step 10; runs a keyword heuristic
 *     today (see lib/ideas/service).
 *   - Convert to Project: pre-filled project form keyed off this idea.
 *
 * Server component: loads idea, project list (for autocomplete),
 * template list, and custom field definitions on render.
 */

import { notFound } from "next/navigation";

import { auth } from "@/auth";
import {
  getCurrentUserPermissions,
  requirePagePermission,
} from "@/lib/auth/permissions";
import {
  ProjectRepository,
  SettingsRepository,
  TemplateRepository,
} from "@/lib/db";
import { getIdea, NotFoundError } from "@/lib/ideas/service";
import { isAiEnabled } from "@/lib/ai/feature-flag";
import { mergeEnumOptions } from "@/lib/projects/enum-options";
import { IdeaReviewPanel } from "@/components/ideas/review-panel";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function AdminIdeaDetailPage({ params }: PageProps) {
  await requirePagePermission("ideas.review");
  const session = await auth();
  if (!session?.user) return null;
  const { permissions } = await getCurrentUserPermissions();

  const { id } = await params;

  let idea;
  try {
    idea = await getIdea(id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const [projects, settings, templates] = await Promise.all([
    ProjectRepository.getAll(),
    SettingsRepository.get(),
    TemplateRepository.getAll(),
  ]);

  const leadOptions = Array.from(
    new Set(projects.map((p) => p.project_lead).filter(Boolean)),
  ).sort();
  const applicationOptions = Array.from(
    new Set(projects.map((p) => p.application_product).filter(Boolean)),
  ).sort();

  // Merged option lists (Section 5.19) — built-ins plus admin-added
  // extensions, archived excluded. The conversion form uses these so
  // promoting an idea picks up admin-defined statuses/phases/priorities.
  const statusOptions = mergeEnumOptions(
    "status",
    settings.enum_extensions.status,
  );
  const phaseOptions = mergeEnumOptions(
    "phase",
    settings.enum_extensions.phase,
  );
  const priorityOptions = mergeEnumOptions(
    "priority",
    settings.enum_extensions.priority,
  );

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="ideas"
      breadcrumbs={[
        { label: "Insights" },
        { label: "Ideas", href: "/admin/ideas" },
        { label: idea.idea_name.length > 40 ? idea.idea_name.slice(0, 40) + "…" : idea.idea_name },
      ]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title="Idea review"
        subtitle="Review the submission, capture notes, run an overlap check, or convert to a project."
      />
      <IdeaReviewPanel
        initialIdea={idea}
        customFields={settings.custom_field_definitions}
        templates={templates}
        leadOptions={leadOptions}
        applicationOptions={applicationOptions}
        statusOptions={statusOptions}
        phaseOptions={phaseOptions}
        priorityOptions={priorityOptions}
        canConvert={permissions["ideas.convert"] === true}
        aiEnabled={isAiEnabled()}
      />
    </PolarisShell>
  );
}

/**
 * Public idea edit page (Section 5.17 follow-up).
 *
 * Account-less: the submitter lands here from the private edit link they
 * were shown on the confirmation screen / emailed. The URL token is the
 * capability — we resolve the idea from it server-side and render one of
 * three states:
 *
 *   1. Invalid / unknown token → a friendly "link not valid" card.
 *   2. Idea already converted   → a read-only notice (editing is frozen).
 *   3. Otherwise                → the pre-filled edit form.
 *
 * Public route. Allow-listed in `middleware.ts` via the `/submit` prefix.
 * force-dynamic so the token is always resolved fresh (never cached).
 */

import Link from "next/link";

import { getIdeaByEditToken } from "@/lib/ideas/service";
import { IdeaEditForm } from "@/components/ideas/edit-form";
import { PublicChrome } from "@/components/polaris/PublicChrome";

export const dynamic = "force-dynamic";

interface EditPageProps {
  params: Promise<{ token: string }>;
}

export default async function EditIdeaPage({ params }: EditPageProps) {
  const { token } = await params;
  const idea = await getIdeaByEditToken(token);

  const converted = Boolean(
    idea && (idea.status === "Converted" || idea.converted_to_project_id),
  );

  return (
    <PublicChrome width="narrow">
      <div style={{ marginBottom: 20 }}>
        <p className="page-eyebrow">Innovation portal</p>
        <h1 className="page-title" style={{ marginTop: 6 }}>
          Edit your idea
        </h1>
        <p className="page-subtitle" style={{ marginTop: 8, lineHeight: 1.55 }}>
          Update the details of an idea you submitted. You can edit it right up
          until the team converts it into a project.
        </p>
      </div>

      {!idea ? (
        <div className="pol-card pol-card-pad">
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--t1)" }}>
            This edit link isn&rsquo;t valid
          </h2>
          <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.55, color: "var(--t2)" }}>
            The link may be mistyped or expired. If you kept the confirmation
            page or email from when you submitted, use the link there. Otherwise
            you can{" "}
            <Link href="/submit" style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}>
              submit a new idea
            </Link>
            .
          </p>
        </div>
      ) : converted ? (
        <div className="pol-card pol-card-pad">
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--t1)" }}>
            &ldquo;{idea.idea_name}&rdquo; has been converted to a project
          </h2>
          <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.55, color: "var(--t2)" }}>
            This idea is now an active project, so it can no longer be edited
            here. Thanks for the submission — reach out to the team if something
            needs to change.
          </p>
        </div>
      ) : (
        <div className="pol-card pol-card-pad">
          <IdeaEditForm
            token={token}
            initial={{
              idea_name: idea.idea_name,
              description: idea.description,
              urgency: idea.urgency,
              requested_target_date: idea.requested_target_date ?? "",
              key_stakeholders: idea.key_stakeholders,
            }}
          />
        </div>
      )}
    </PublicChrome>
  );
}

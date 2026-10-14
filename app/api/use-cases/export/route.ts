/**
 * GET /api/use-cases/export → download the Use Cases page as a Markdown file
 * (usecases.manage, same gate as the page itself).
 */

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  NiceProductRepository,
  ProjectRepository,
  UseCaseRepository,
} from "@/lib/db";
import { buildUseCasesMarkdown } from "@/lib/use-cases/markdown";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  await requirePermission("usecases.manage");

  const [useCases, projects, niceProducts] = await Promise.all([
    UseCaseRepository.getAll(),
    ProjectRepository.getAll(),
    NiceProductRepository.getAll(),
  ]);

  const date = new Date().toISOString().slice(0, 10);
  const body = buildUseCasesMarkdown(useCases, projects, niceProducts, date);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="use-cases-${date}.md"`,
      "Cache-Control": "no-store",
    },
  });
});

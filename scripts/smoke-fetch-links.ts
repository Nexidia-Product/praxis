/**
 * Functional smoke test for GitHub Markdown link ingestion
 * (`lib/ai/documents/fetch-links.ts`), used to ground document generation.
 *
 * Two slices are exercised:
 *   1. githubBlobToRaw / isFetchableMarkdown — pure URL resolution (no network)
 *   2. fetchLinkedDocs — selection, truncation, and failure handling with a
 *      stubbed global.fetch (no real network calls)
 *
 * Run with:
 *   npx tsx scripts/smoke-fetch-links.ts
 *
 * Exits non-zero on the first assertion failure.
 */

async function main() {
  const { githubBlobToRaw, isFetchableMarkdown, fetchLinkedDocs } =
    await import("../lib/ai/documents/fetch-links");

  type DocumentLink = import("../lib/db").DocumentLink;

  let passed = 0;
  function check(label: string, cond: unknown): void {
    if (!cond) {
      console.error(`FAIL: ${label}`);
      process.exit(1);
    }
    passed++;
    console.log(`  ok  ${label}`);
  }

  const link = (url: string, label = "doc"): DocumentLink => ({
    label,
    url,
    link_type: "GitHub Repo",
    added_by: "u1",
    added_at: "2026-01-01T00:00:00.000Z",
  });

  // ==========================================================================
  // 1. githubBlobToRaw / isFetchableMarkdown
  // ==========================================================================

  console.log("\ngithubBlobToRaw");
  check(
    "blob .md → raw",
    githubBlobToRaw(
      "https://github.com/acme/repo/blob/main/docs/spec.md",
    ) === "https://raw.githubusercontent.com/acme/repo/main/docs/spec.md",
  );
  check(
    "blob nested path .markdown → raw",
    githubBlobToRaw(
      "https://github.com/acme/repo/blob/feat/x/a/b/c.markdown",
    ) === "https://raw.githubusercontent.com/acme/repo/feat/x/a/b/c.markdown",
  );
  check(
    "raw URL passes through (query/hash dropped)",
    githubBlobToRaw(
      "https://raw.githubusercontent.com/acme/repo/main/README.md?token=abc#L5",
    ) === "https://raw.githubusercontent.com/acme/repo/main/README.md",
  );
  check(
    "www.github.com host handled",
    githubBlobToRaw("https://www.github.com/a/b/blob/main/x.md") ===
      "https://raw.githubusercontent.com/a/b/main/x.md",
  );
  check(
    "non-markdown blob → null",
    githubBlobToRaw("https://github.com/acme/repo/blob/main/src/app.ts") ===
      null,
  );
  check(
    "repo root (no blob) → null",
    githubBlobToRaw("https://github.com/acme/repo") === null,
  );
  check(
    "non-github host → null",
    githubBlobToRaw("https://example.com/docs/spec.md") === null,
  );
  check("garbage URL → null", githubBlobToRaw("not a url") === null);

  console.log("\nisFetchableMarkdown");
  check(
    "fetchable blob md",
    isFetchableMarkdown(link("https://github.com/a/b/blob/main/x.md")) === true,
  );
  check(
    "non-fetchable repo root",
    isFetchableMarkdown(link("https://github.com/a/b")) === false,
  );

  // ==========================================================================
  // 2. fetchLinkedDocs (stubbed fetch)
  // ==========================================================================

  const realFetch = global.fetch;
  const calls: string[] = [];

  function stub(
    responder: (url: string) => { ok: boolean; status: number; body: string },
  ): void {
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const r = responder(url);
      return {
        ok: r.ok,
        status: r.status,
        async text() {
          return r.body;
        },
      } as Response;
    }) as typeof fetch;
  }

  try {
    console.log("\nfetchLinkedDocs — happy path + selection");
    calls.length = 0;
    stub((url) => ({ ok: true, status: 200, body: `# Body of ${url}` }));
    const docs = await fetchLinkedDocs([
      link("https://github.com/a/b/blob/main/one.md", "One"),
      link("https://github.com/a/b/blob/main/src/app.ts", "Code"), // skipped
      link("https://example.com/x.md", "Ext"), // skipped
      link("https://github.com/a/b/blob/main/two.md", "Two"),
    ]);
    check("only fetchable links fetched (2)", docs.length === 2);
    check("no fetch for non-fetchable links", calls.length === 2);
    check(
      "content + label + url preserved",
      docs[0].label === "One" &&
        docs[0].url === "https://github.com/a/b/blob/main/one.md" &&
        docs[0].content.includes("Body of"),
    );

    console.log("\nfetchLinkedDocs — HTTP error is dropped, not thrown");
    stub((url) =>
      url.includes("gone.md")
        ? { ok: false, status: 404, body: "" }
        : { ok: true, status: 200, body: "# ok" },
    );
    const docs2 = await fetchLinkedDocs([
      link("https://github.com/a/b/blob/main/gone.md"),
      link("https://github.com/a/b/blob/main/here.md"),
    ]);
    check("404 dropped, 200 kept", docs2.length === 1);

    console.log("\nfetchLinkedDocs — oversized content truncated");
    const big = "x".repeat(200 * 1024);
    stub(() => ({ ok: true, status: 200, body: big }));
    const docs3 = await fetchLinkedDocs([
      link("https://github.com/a/b/blob/main/big.md"),
    ]);
    check("content truncated below original size", docs3[0].content.length < big.length);
    check(
      "truncation marker present",
      docs3[0].content.includes("(truncated)"),
    );

    console.log("\nfetchLinkedDocs — MAX_DOCS cap (5)");
    calls.length = 0;
    stub(() => ({ ok: true, status: 200, body: "# ok" }));
    const many = Array.from({ length: 8 }, (_, i) =>
      link(`https://github.com/a/b/blob/main/f${i}.md`),
    );
    const docs4 = await fetchLinkedDocs(many);
    check("caps fetched docs at 5", docs4.length === 5 && calls.length === 5);
  } finally {
    global.fetch = realFetch;
  }

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});

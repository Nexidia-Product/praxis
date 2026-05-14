"use client";

/**
 * Global search bar (Step 13).
 *
 * Lives in the application header next to the notification bell.
 * Behavior:
 *
 *   - Cmd/Ctrl+K (or `/` outside an input) focuses the search input.
 *   - Typing 2+ characters opens a dropdown of matching projects,
 *     tasks, and ideas (idea results gated by `ideas.review`).
 *   - Arrow keys move selection; Enter follows; Esc closes.
 *   - Clicks outside the dropdown close it.
 *
 * The component is intentionally self-contained — no global state, no
 * external store. The unauthenticated public submit page does not
 * mount the shell, so this never renders without a session.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SearchHit {
  type: "Project" | "Task" | "Idea";
  id: string;
  label: string;
  detail: string;
  href: string;
  matched: "id" | "name" | "description";
}

interface SearchResponse {
  hits: SearchHit[];
  total: number;
  q: string;
}

const DEBOUNCE_MS = 200;
const MIN_QUERY_LEN = 2;

export function GlobalSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const [query, setQuery] = useState<string>("");
  const [debouncedQuery, setDebouncedQuery] = useState<string>("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Debounce the query so each keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // Run the search whenever the debounced query is long enough.
  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LEN) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(debouncedQuery)}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (!res.ok) {
          setHits([]);
          setError(`Search failed (HTTP ${res.status}).`);
          return;
        }
        const data = (await res.json()) as SearchResponse;
        if (cancelled) return;
        setHits(data.hits);
        setActiveIndex(data.hits.length > 0 ? 0 : -1);
      } catch (err) {
        if (cancelled) return;
        setHits([]);
        setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Global keyboard shortcut to focus the input. Cmd/Ctrl+K everywhere;
  // a bare "/" key only when the user isn't typing into something else
  // (matches GitHub / Linear / Slack conventions).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isShortcut =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const isSlash = e.key === "/" && !inEditable;
      if (isShortcut || isSlash) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close the dropdown when clicking / focusing outside.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const goToHit = useCallback(
    (hit: SearchHit) => {
      closeAndReset();
      setQuery("");
      router.push(hit.href);
    },
    [router, closeAndReset],
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeAndReset();
      inputRef.current?.blur();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (hits.length === 0 ? -1 : (i + 1) % hits.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        hits.length === 0 ? -1 : (i - 1 + hits.length) % hits.length,
      );
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < hits.length) {
        e.preventDefault();
        goToHit(hits[activeIndex]);
      }
    }
  }

  const showDropdown =
    open &&
    (loading ||
      error !== null ||
      hits.length > 0 ||
      query.trim().length >= MIN_QUERY_LEN);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: 280 }}
    >
      <label htmlFor="iim-global-search" className="sr-only">
        Search projects, tasks, and ideas
      </label>
      <input
        id="iim-global-search"
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (query.trim().length >= MIN_QUERY_LEN) setOpen(true);
        }}
        onKeyDown={onInputKeyDown}
        placeholder="Search projects, tasks, ideas…"
        aria-label="Search"
        aria-expanded={Boolean(showDropdown)}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          showDropdown && activeIndex >= 0
            ? `${listboxId}-opt-${activeIndex}`
            : undefined
        }
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        style={{
          width: "100%",
          height: 28,
          padding: "0 30px 0 10px",
          borderRadius: "var(--pol-radius)",
          border: "1px solid rgba(255,255,255,.25)",
          background: "rgba(255,255,255,.12)",
          color: "#fff",
          fontSize: 12,
          outline: "none",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          color: "rgba(255,255,255,.6)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.5,
          padding: "1px 4px",
          border: "1px solid rgba(255,255,255,.25)",
          borderRadius: 2,
          pointerEvents: "none",
        }}
      >
        ⌘K
      </span>

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            left: 0,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--pol-radius)",
            boxShadow: "0 4px 16px rgba(0,0,0,.12)",
            zIndex: 30,
            minWidth: 360,
            maxHeight: 420,
            overflowY: "auto",
            // Push the dropdown left a bit so it doesn't get clipped at
            // narrow viewports — the input itself is only 280px wide,
            // but the result rows benefit from more room.
            marginLeft: 0,
          }}
        >
          {loading ? (
            <p
              role="status"
              style={{
                padding: "16px",
                fontSize: 12,
                color: "var(--tm)",
                textAlign: "center",
              }}
            >
              Searching…
            </p>
          ) : error ? (
            <p
              role="alert"
              style={{
                padding: "16px",
                fontSize: 12,
                color: "var(--err)",
                textAlign: "center",
              }}
            >
              {error}
            </p>
          ) : hits.length === 0 ? (
            <p
              style={{
                padding: "16px",
                fontSize: 12,
                color: "var(--tm)",
                textAlign: "center",
              }}
            >
              No matches for “{debouncedQuery}”.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: "4px 0" }}>
              {hits.map((hit, index) => (
                <li
                  key={`${hit.type}-${hit.id}`}
                  id={`${listboxId}-opt-${index}`}
                  role="option"
                  aria-selected={activeIndex === index}
                >
                  <Link
                    href={hit.href}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={(e) => {
                      e.preventDefault();
                      goToHit(hit);
                    }}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      padding: "8px 12px",
                      textDecoration: "none",
                      color: "var(--t1)",
                      background:
                        activeIndex === index ? "var(--hover)" : "transparent",
                    }}
                  >
                    <TypeBadge type={hit.type} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "baseline",
                        }}
                      >
                        <span className="mono" style={{ color: "var(--tm)" }}>
                          {hit.id}
                        </span>
                        <span
                          style={{
                            fontWeight: 600,
                            color: "var(--t1)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {hit.label}
                        </span>
                      </div>
                      {hit.detail ? (
                        <p
                          style={{
                            margin: "2px 0 0",
                            fontSize: 11,
                            color: "var(--t2)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {hit.detail}
                        </p>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TypeBadge({ type }: { type: SearchHit["type"] }) {
  const cls =
    type === "Project"
      ? "pol-tag-blue"
      : type === "Task"
        ? "pol-tag-teal"
        : "pol-tag-pink";
  return (
    <span
      className={`pol-tag ${cls}`}
      style={{ flexShrink: 0, marginTop: 1 }}
    >
      {type}
    </span>
  );
}

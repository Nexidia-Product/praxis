---
name: lyra-visual-patterns
description: Visual reference for what a correctly-converted Lyra page looks like in light and dark mode. Load this BEFORE running `convert_page_to_lyra` / `migrate_to_lyra` / `convert_mode`, or when advising a user on whether to run a full conversion vs. a tokens-only pass. Covers page chrome, surfaces, filter rows, stat tiles, tables, side panels, nav, chips, and AI affordances. Use it to (a) set user expectations for the output, (b) validate audit results against the intended visual, and (c) decide scope (tokens-only vs. full page conversion).
disable-model-invocation: false
---

# Lyra Visual Patterns — Light & Dark

This skill documents the canonical Lyra page look so the plugin + MCP can reason about conversions visually, not just token-wise. The design-token layer already lives in the plugin; this is the **composition** layer — the patterns a correctly-converted page exhibits.

## When to use

Invoke this skill whenever the user:

- Asks "convert this page to Lyra", "make this Lyra-compliant", "fix the tokens", or "apply Lyra".
- Asks for a preview / before-after of a conversion.
- Wants dark-mode parity for an already-Lyra'd light page (or vice versa) via `convert_mode`.
- Asks why an audit is flagging something as non-compliant when the tokens look right.

## The two conversion modes — how to present the choice

When a user says "convert this to Lyra", **ask which mode they want**:

1. **Tokens-only pass** (precision, non-destructive)
   - Runs color/text/spacing/radius token swaps via `convert_page_to_lyra` (Chrome) or `migrate_to_lyra` (Figma) with each apply* flag selectively set.
   - Preserves existing layout, component structure, and custom styling.
   - Best for: **demos, production pages, initial design reviews** where layout is already correct and only the design-system layer needs to be swapped.
   - Lowest risk. Always offer this first.

2. **Full attempted conversion** (breadth, higher risk)
   - Tokens + layout normalization + component swaps + accessibility fixes + (in Figma) `convert_page_to_lyra` plugin-side rewrite.
   - Best for: **early-stage mockups, hand-coded prototypes, pages being rebuilt for Lyra from scratch**.
   - Will restructure. User should expect to review and tweak after.

Phrase the question roughly as: *"Do you want a **tokens-only pass** (precise — keeps layout, just swaps to Lyra tokens) or a **full conversion** (broader — also normalizes layout and components)? Tokens-only is safer for demos and finished designs."*

## Global page anatomy (common to every Lyra page observed)

Every Lyra page has these stacked regions, top to bottom:

1. **Top bar** (horizontal, full-width)
   - Left: workspace / tenant switcher (e.g. "Cognigy AI ▾", "Workforce Management ▾", "New Analytics ▾"). Caret indicates popover.
   - Right cluster (in this order): help `?` icon, notification bell with red count badge, circular user avatar with initials.
   - Background: matches page chrome (see surface rules below). No bottom border in dark; subtle in light.

2. **Left rail navigation** (vertical, full-height, collapsible)
   - Icon + label rows; active row uses **filled light-blue background + blue icon + semibold label** in light, and **subtle blue-tinted surface** in dark.
   - Expandable groups show a chevron and indent.
   - Collapsed state shows icons only; active state persists.

3. **Main content area** (card/surface on page background)
   - A single large rounded surface containing: optional breadcrumbs → page title → toolbar (filters/search) → content (table, dashboard, detail, chat, etc.) → optional footer.
   - Top-right of the main card: the **AI sparkle** (✦) icon — always present, always in the same spot.

4. **Optional right panel** (chat, inspector, details) — its own surface, seamed against the main surface.

## Surface & elevation rules

| Region | Light | Dark |
|---|---|---|
| Page background (outside card) | Neutral gray (~`#E4E5E7` / token: `color/surface/canvas`) | Pure or near-pure black (`#000` / token: `color/surface/canvas`) |
| Primary surface (main card) | White (`#FFFFFF`) with soft shadow + rounded corners (~12px) | Elevated dark gray (~`#1A1A1A`–`#1F1F1F`), **no shadow**, same rounded corners. Separation comes from surface contrast against the black page bg, not from shadow. |
| Secondary surface (inner panel, popover, dropdown) | White with 1px hairline border (`#E5E7EB`-ish) | Same dark surface, lifted one step (~`#242424`) or bordered with a very dark line |
| Input / filter chip | White fill + hairline border | Same dark surface fill + slightly lighter border |

**Critical dark-mode rule:** do **not** carry the light-mode drop shadow into dark. Dark surfaces separate via value contrast, not shadow. An audit that flags a persistent shadow in dark mode is correct — strip it.

## Typography rules

- Page title: large semibold (~20–24px), high-contrast text token.
- Section/row text: regular weight, `color/text/primary`.
- Meta / helper text: muted token (`color/text/secondary` or `/tertiary`).
- Links (e.g. "Deflect ~28% with a billing FAQ agent"): **Lyra blue** in both modes — hue stays, luminance may shift slightly darker in light / lighter in dark. Never re-tint to gray.

## Chips, badges, and stat tiles

- **Stat tiles** (e.g. "70 Active Agents"): value in large number, label below in muted text, whole tile bordered. The **active/selected** tile gets a **blue outline + blue value color**. Others get a neutral border.
- **Severity chips** (High/Medium/Low, open/closed): use semantic tokens.
  - High: red-tinted pill (light: soft pink bg + dark red text; dark: deep red-tinted bg + light red text)
  - Medium: amber/yellow pill (same pattern)
  - Low / neutral: gray pill
- **Filter pill dropdowns** ("Scheduling Unit: NY East ▾", "Skill: 4 selected ▾"): tinted background (soft blue in light, tinted dark in dark), label + `:` + value + caret, `×` to clear.
- The **"Clear"** reset link sits at the end of the filter row, no button chrome, plain muted text link.

## Tables

- Header row: muted text, no heavy divider — just a thin line below.
- Rows: zero vertical borders; horizontal hairline between rows in light; in dark the rows sit on the card surface with very subtle separators.
- **Adherence / deviation cells** get a **soft red background wash** for out-of-tolerance values (light: pale pink; dark: desaturated deep red). Value stays legible.
- Row actions live in a trailing `⋮` icon column.
- Primary identifier (agent name, etc.) renders as a **blue link**.

## Login / unauthenticated pages

- Split layout: **centered form on neutral surface** (left 50–60%) + **blue gradient hero panel** (right 40–50%) with large marketing title (e.g. "NiCE World / June 8–10, 2026").
- Logo: "NiCE CX**one**" with the "one" in a pill-shaped blue token.
- Primary CTA ("Next"): full-width blue button.
- Secondary CTA ("Company Domain"): pill outlined button.
- The blue gradient panel is **identical in light and dark** — it is a branded asset that does not re-theme. The surrounding chrome does.

## Chat / conversation surfaces (AI agent test panels)

- Outbound user message: **light-blue bubble**, right-aligned, user avatar (initials) on the right.
- Inbound AI message: **no bubble** — just text on the surface with a small square AI icon to the left and a timestamp below.
- Composer at bottom: input field + mode pill ("Chat ▾") + send button (blue, arrow icon).
- Tabs above the conversation (Test / Transcript / Input / Context) — active tab gets a blue underline and blue semibold label.
- Background **grid / dot pattern** on the main canvas (visible in light as pale dots on white; in dark as faint lighter dots on the dark surface). Preserve this; it's a Lyra canvas affordance.

## Workspace switcher popover

- Triggered by the top-left tenant name.
- Grouped list with **role group** (Supervisor / Agent / Cognigy AI / My Zone) → divider → **app group** (Workforce Management / Performance Management / Interaction Hub) → divider → **view group** (Dashboard / Analytics) → divider → Admin.
- Each row: icon + label. Hovered row gets a subtle surface tint.
- Popover uses the secondary-surface rules (bordered in light, elevated dark in dark).

## Dashboard widgets

- KPI cards: title + optional info `ⓘ` icon top-right, big number, trend chip (e.g. "↑" green), caption beneath.
- Bar charts: **two-tone blue bars** — darker blue for primary series, pale blue for comparison/secondary. In dark mode, the dark bar becomes a saturated Lyra blue and the secondary shifts to a deeper blue-navy. Axes + labels use muted text token.
- "Upcoming …" list widgets: icon + title + meta row with calendar icon and duration chip.

## Accessibility invariants (enforced by audit)

- Primary text on primary surface ≥ 4.5:1 in both modes.
- Blue interactive tokens preserve hue across modes; do not swap to teal / purple.
- Focus ring: 2px Lyra-blue outline with 2px offset (token `color/border/focus`).
- Semantic chip foreground/background pairs stay within contrast budget in dark — if audit flags a red chip in dark as low-contrast, the fix is to lift the foreground, not to drop the bg saturation to gray.

## Mode-flip (convert_mode) expectations

When converting an already-Lyra light page → dark (or reverse), a correct result should:

1. Swap **page background** canvas token first. This is the single biggest visual delta.
2. Swap **surface** tokens (cards, popovers, inputs) — not repaint with raw hex.
3. Drop / add **shadow** per the surface rules above.
4. Leave blue / semantic **accent hues** essentially in place (tokens handle the luminance shift).
5. Leave the **blue gradient marketing panel** (login hero, etc.) untouched.
6. Preserve the **canvas dot-grid** pattern — re-token its dot color, don't remove it.

If a converted dark page still shows a white card with a drop shadow, the surface token did not swap — re-run with `applyColors: true` and verify via `audit_colors`.

## How to use this skill with the MCP tools

Typical flow the agent should follow when the user asks for a Lyra conversion:

1. **Load this skill** (you're here).
2. Call `list_targets` to know whether to operate on Chrome, Figma, or both.
3. Ask the user: *tokens-only vs. full conversion?* (see "two conversion modes" above).
4. Run `lyra_compliance_report` (or `run_full_audit`) for a baseline.
5. For **tokens-only**: call `convert_page_to_lyra` (Chrome) or `migrate_to_lyra` (Figma) with only the relevant `apply*` flags true, and `dryRun: true` first so the user can review the preview.
6. Validate the result against the patterns in this skill. Flag deviations (e.g. "card still has a shadow in dark — surface token didn't swap").
7. Re-audit and summarize the delta.

When the user asks for a **mode flip** only, use `convert_mode` and validate against the "Mode-flip expectations" section.

## What NOT to do

- Don't invent new tokens or raw hex — always prefer the existing Lyra token set (see `export_design_tokens`).
- Don't attempt a full conversion silently when the user says "convert to Lyra" — always surface the tokens-only vs. full choice first.
- Don't treat the branded blue gradient panels, product logos, or canvas dot-grids as non-compliant — they are intentional and theme-invariant.
- Don't strip semantic color from chips / tables in dark mode just because contrast is tight; lift foreground instead.

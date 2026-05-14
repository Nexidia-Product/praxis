import type { Config } from "tailwindcss";

/**
 * Tailwind theme tuned to the NICE NIA / QC Polaris palette.
 *
 * The strategy: keep existing Tailwind utility classes throughout the
 * codebase, but tune their resolved colors so the visual result is
 * already on-system. `text-gray-700` → Polaris secondary text;
 * `bg-emerald-50` → Polaris ok-bg; `border-gray-200` → Polaris border;
 * etc. New visual work should still reach for the `pol-*` primitives
 * defined in `app/polaris.css`, but rebinding the palette here means we
 * don't need to chase every utility class through every component.
 *
 * We override the *standard* color names rather than extending — that
 * way `bg-gray-100` etc. uses the override automatically.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    fontFamily: {
      sans: [
        "Open Sans",
        "system-ui",
        "-apple-system",
        "sans-serif",
      ],
      mono: [
        "ui-monospace",
        "SFMono-Regular",
        "Menlo",
        "Consolas",
        "Liberation Mono",
        "monospace",
      ],
    },
    extend: {
      colors: {
        // Polaris-aligned neutrals. Every shade resolves into the same
        // small set of tokens so the visual language stays tight.
        gray: {
          50: "#f4f8fa", // var(--bg)
          100: "#f0f2f3",
          200: "#e2e6e9", // var(--border)
          300: "#d5dde2",
          400: "#abbac3",
          500: "#859ead", // var(--tm)
          600: "#526b7a", // var(--t2)
          700: "#3f5663",
          800: "#2e2e2e", // var(--t1)
          900: "#1f2429",
        },
        // Slate aliased to gray (some files use slate-*).
        slate: {
          50: "#f4f8fa",
          100: "#f0f2f3",
          200: "#e2e6e9",
          300: "#d5dde2",
          400: "#abbac3",
          500: "#859ead",
          600: "#526b7a",
          700: "#3f5663",
          800: "#2e2e2e",
          900: "#1f2429",
        },
        // Brand. The 600 / 700 align with --brand and --brand-dark.
        sky: {
          50: "#eaf3f8",
          100: "#cee4f0",
          200: "#9fc8df",
          300: "#5ea7cc",
          400: "#1f8ec2",
          500: "#0086c6",
          600: "#007bbd", // var(--brand)
          700: "#006da8", // var(--brand-dark)
          800: "#005a8c",
          900: "#04476f",
        },
        blue: {
          50: "#eaf3f8",
          100: "#cee4f0",
          200: "#9fc8df",
          300: "#5ea7cc",
          400: "#1f8ec2",
          500: "#0086c6",
          600: "#007bbd",
          700: "#006da8",
          800: "#005a8c",
          900: "#04476f",
        },
        // Status: green (ok)
        emerald: {
          50: "#e7f3ef", // var(--ok-bg)
          100: "#d3eadf",
          200: "#b0d9c8",
          300: "#7cc1a8",
          400: "#3ea683",
          500: "#1d8a64",
          600: "#00703c", // var(--ok)
          700: "#006135",
          800: "#0a4f2d",
          900: "#0c3f24",
        },
        green: {
          50: "#e7f3ef",
          100: "#d3eadf",
          200: "#b0d9c8",
          300: "#7cc1a8",
          400: "#3ea683",
          500: "#1d8a64",
          600: "#00703c",
          700: "#006135",
          800: "#0a4f2d",
          900: "#0c3f24",
        },
        // Status: amber (warn)
        amber: {
          50: "#fff0d1", // var(--warn-bg)
          100: "#ffe5a8",
          200: "#fdd47b",
          300: "#fcc547",
          400: "#fcb91d", // var(--warn)
          500: "#d99e0e",
          600: "#a87a08",
          700: "#8a6200", // var(--warn-text)
          800: "#6e4f00",
          900: "#5a4100",
        },
        yellow: {
          50: "#fff0d1",
          100: "#ffe5a8",
          200: "#fdd47b",
          300: "#fcc547",
          400: "#fcb91d",
          500: "#d99e0e",
          600: "#a87a08",
          700: "#8a6200",
          800: "#6e4f00",
          900: "#5a4100",
        },
        orange: {
          50: "#ffeede",
          100: "#fed7b3",
          200: "#fdba81",
          300: "#fc9a4d",
          400: "#fa7d20",
          500: "#e16100",
          600: "#bd5000",
          700: "#993f00",
          800: "#7d3300",
          900: "#612800",
        },
        // Status: red (err)
        red: {
          50: "#fcedf0", // var(--err-bg)
          100: "#fbd9de",
          200: "#f5b8b8",
          300: "#ed8e8e",
          400: "#e36161",
          500: "#dc4a40",
          600: "#d4341c", // var(--err)
          700: "#b62b18",
          800: "#922211",
          900: "#751a0e",
        },
        rose: {
          50: "#fcedf0",
          100: "#fbd9de",
          200: "#f9d4c8", // var(--neg)
          300: "#ed8e8e",
          400: "#e36161",
          500: "#dc4a40",
          600: "#d4341c",
          700: "#b62b18",
          800: "#922211",
          900: "#751a0e",
        },
        // Health score (used in chart fills)
        health: {
          green: "#00703c",
          yellow: "#fcb91d",
          red: "#d4341c",
        },
      },
      borderRadius: {
        // 3px is the Polaris standard. Tailwind's default `rounded`
        // (0.25rem = 4px) maps to that for visual parity, but `rounded-md`
        // and `rounded-lg` step up only modestly so cards and buttons
        // stay close to the system's compact look.
        DEFAULT: "3px",
        sm: "2px",
        md: "3px",
        lg: "4px",
        xl: "6px",
      },
    },
  },
  plugins: [],
};

export default config;

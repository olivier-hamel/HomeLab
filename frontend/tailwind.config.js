/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist Mono Variable", "ui-monospace", "monospace"],
        mono: ["Geist Mono Variable", "ui-monospace", "monospace"],
      },
      spacing: { 70: "17.5rem" },
      colors: {
        neutral: { 850: "#1f1f1f" },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        ...Object.fromEntries(
          ["card", "primary", "secondary", "muted", "accent", "destructive"].map((name) => [
            name,
            { DEFAULT: `hsl(var(--${name}))`, foreground: `hsl(var(--${name}-foreground))` },
          ]),
        ),
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

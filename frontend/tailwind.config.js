/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "Roboto Mono", "ui-monospace", "monospace"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Neutral spine — paper / ink
        ink: {
          50:  "#f7f8f7",
          100: "#eef0ef",
          200: "#d9ddd9",
          300: "#b4bab5",
          400: "#838c84",
          500: "#5a635c",
          600: "#3f4640",
          700: "#2a2f2b",
          800: "#191c1a",
          900: "#0d0f0e",
        },
        // Accent — a soft, slightly desaturated terminal-green.
        moss: {
          50:  "#eef9f1",
          100: "#d5f1de",
          200: "#aae3bd",
          300: "#74cf94",
          400: "#3fb46d",
          500: "#1e9352",
          600: "#137441",
          700: "#0f5b35",
          800: "#0c472b",
          900: "#093a24",
        },
      },
      boxShadow: {
        "moss-glow": "0 0 0 1px rgba(63, 180, 109, 0.4), 0 8px 24px -10px rgba(63, 180, 109, 0.35)",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        fadeIn:  { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        slideUp: { "0%": { opacity: 0, transform: "translateY(8px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};

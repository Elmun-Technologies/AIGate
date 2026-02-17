import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#f4f6f9",
        ink: "#0f172a",
        accent: "#0f766e",
        panel: "#ffffff"
      }
    },
  },
  plugins: [],
};

export default config;

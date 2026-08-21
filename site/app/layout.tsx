import type { Metadata, Viewport } from "next";
import { Fraunces, Nunito_Sans } from "next/font/google";

import "@/styles/tokens.css";
import "@/styles/site.css";

/**
 * Both faces are pulled at build time and served from this origin — the page
 * claims no third-party requests, and a stylesheet fetched from
 * fonts.googleapis.com would make that untrue on the first paint.
 *
 * Fraunces for the serif voice: warm, round-shouldered, soft where New York
 * and Palatino are sharp. Nunito Sans for the UI voice: humanist, with
 * rounded terminals that sit naturally next to it.
 */
const serif = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-soft-serif",
  style: ["normal", "italic"],
});

const sans = Nunito_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-soft-sans",
});

export const metadata: Metadata = {
  title: "Muninn — Wake me when it's done.",
  description:
    "An open-source macOS menu-bar companion for CLI coding agents. When a turn finishes, " +
    "Muninn tells you what your agent actually did — so you can walk away.",
  openGraph: {
    type: "website",
    title: "Muninn — Wake me when it's done.",
    description:
      "When your coding agent finishes a turn, a calm panel says what happened — so you can walk away.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1a1013" },
    { media: "(prefers-color-scheme: light)", color: "#fbf1e8" },
  ],
};

/**
 * Applied before first paint, so a stored preference never shows as a flash of
 * the other theme.
 *
 * Absence of the attribute is meaningful — it is what makes the stylesheet
 * follow the system — so this must not write a default when nothing is stored.
 */
const NO_FLASH = `try{var t=localStorage.getItem("mn-theme");
if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

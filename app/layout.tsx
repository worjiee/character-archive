import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import type { CSSProperties } from "react";
import { getRepositorySettings } from "@/src/lib/settings";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Character Archive",
  description: "A private character repository for chatbot projects.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const settings = await getRepositorySettings();
  const accentColor = settings.accentColor ?? "#d6a84b";
  const themeStyle = {
    "--accent-color": accentColor,
    "--accent-foreground": contrastForeground(accentColor),
  } as CSSProperties;
  return (
    <html lang="en" data-theme={settings.defaultTheme} style={themeStyle} suppressHydrationWarning className="h-full">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-full font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}

function contrastForeground(hexColor: string): "#09090b" | "#ffffff" {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hexColor.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const darkContrast = (luminance + 0.05) / 0.05;
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast ? "#09090b" : "#ffffff";
}

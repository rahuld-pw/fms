import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale, getMessages } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Campus Ops", template: "%s · Campus Ops" },
  description: "Facility, expense, task and purchase management for schools and institutes",
  applicationName: "Campus Ops",
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Campus Ops", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  // Layout stays left-to-right for every language (Urdu text still renders
  // right-to-left inside its blocks); the UI uses physical spacing utilities.
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        <I18nProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}

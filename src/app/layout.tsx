import type { Metadata } from "next";
import { Providers } from "@/components/client-bits";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VisaGuard", template: "%s · VisaGuard" },
  description: "Case management and risk screening for study-visa consultancies. AI recommends and explains; a human decides.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

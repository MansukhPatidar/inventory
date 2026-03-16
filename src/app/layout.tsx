import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Parts Inventory",
  description: "Electronics parts inventory with QR scanning",
  manifest: "manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Inventory",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a1a2e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="apple-touch-icon" href="icon-192.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="min-h-dvh flex flex-col">
          <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
            <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
              <Link href="/" className="font-bold text-lg tracking-tight text-primary">
                Parts
              </Link>
              <nav className="flex gap-1">
                <NavLink href="/parts/new">+ Add</NavLink>
                <NavLink href="/labels">Labels</NavLink>
              </nav>
            </div>
          </header>
          <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
            {children}
          </main>
        </div>
        <Toaster theme="dark" richColors />
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
    >
      {children}
    </Link>
  );
}

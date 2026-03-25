import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Package, Grid3X3, Plus, Tags, Search } from "lucide-react";
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
        <link rel="icon" href="icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="icon-192.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="min-h-dvh flex flex-col">
          <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
            <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight text-primary">
                <Package size={20} />
                <span>Inventory</span>
              </Link>
              <nav className="flex items-center gap-0.5">
                <NavLink href="/" icon={<Search size={16} />}>Search</NavLink>
                <NavLink href="/storage" icon={<Grid3X3 size={16} />}>Boxes</NavLink>
                <NavLink href="/parts/new" icon={<Plus size={16} />}>Add</NavLink>
                <NavLink href="/labels" icon={<Tags size={16} />}>Labels</NavLink>
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

function NavLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Link>
  );
}

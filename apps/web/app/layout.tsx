import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "./sw-register";

export const metadata: Metadata = {
  title: "Phenomenal Grow",
  description: "Turn Conversations Into Growth",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Phenomenal Grow", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#0891b2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('pg-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ServiceWorker />
        {children}
      </body>
    </html>
  );
}

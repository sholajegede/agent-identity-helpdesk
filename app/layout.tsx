import type {Metadata} from 'next';
// @ts-ignore TS2307: Cannot find module or type declarations for side-effect import of './globals.css'.
import './globals.css';
import ConvexClientProvider from './ConvexClientProvider';

export const metadata: Metadata = {
  title: 'Agent Identity Helpdesk',
  description:
    'A support desk rebuilt from the July 2025 Supabase MCP leak — five modes, each failing in a way the next one fixes. Kinde + Convex.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap"
        />
      </head>
      <body>
        <span className="crop tl" />
        <span className="crop tr" />
        <span className="crop bl" />
        <span className="crop br" />
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}

import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'QuickTable',
  description: 'Paste tables from Excel or the web into Sitecore.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

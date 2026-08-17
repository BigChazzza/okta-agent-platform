import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Okta AI Agent Console',
  description: 'Register, govern and manage AI agents with Okta',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}

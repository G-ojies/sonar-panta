import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Sonar for Panta',
  description: 'Behavioural signals, cross-venue pricing and one-click non-custodial trading for Panta prediction markets on Solana.',
  icons: { icon: '/icon.svg', apple: '/apple-icon.png' },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sonar-panta.vercel.app'),
  openGraph: { title: 'Sonar for Panta', description: 'The intelligence layer for on-chain prediction markets. Powered by Panta.', images: ['/screens/radar.png'] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

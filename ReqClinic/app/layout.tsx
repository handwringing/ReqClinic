import type { Metadata } from 'next';
import {
  Fraunces,
  IBM_Plex_Mono,
  JetBrains_Mono,
  Noto_Sans_SC,
  Noto_Serif_SC,
  Source_Serif_4,
} from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const fraunces = Fraunces({
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'optional',
  preload: false,
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
});

const sourceSerif = Source_Serif_4({
  display: 'optional',
  preload: false,
  style: ['normal'],
  variable: '--font-source-serif-4',
  weight: ['500', '600', '700'],
});

const notoSerif = Noto_Serif_SC({
  display: 'optional',
  preload: false,
  variable: '--font-noto-serif-sc',
  weight: ['300', '400', '500', '600', '700'],
});

const notoSans = Noto_Sans_SC({
  display: 'optional',
  preload: false,
  variable: '--font-noto-sans-sc',
  weight: ['400', '500', '600', '700'],
});

const ibmPlexMono = IBM_Plex_Mono({
  display: 'optional',
  preload: false,
  variable: '--font-ibm-plex-mono',
  weight: ['300', '400', '500'],
});

const jetBrainsMono = JetBrains_Mono({
  display: 'optional',
  preload: false,
  variable: '--font-jetbrains-mono',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'Requirements Clinic',
  description: '通过连续追问整理需求',
  icons: {
    icon: process.env.GITHUB_PAGES === 'true' ? '/ReqClinic/icon.svg' : '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const fontVariables = [
    fraunces.variable,
    sourceSerif.variable,
    notoSerif.variable,
    notoSans.variable,
    ibmPlexMono.variable,
    jetBrainsMono.variable,
  ].join(' ');

  return (
    <html lang="zh-CN">
      <body className={fontVariables}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

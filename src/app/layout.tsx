import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { StoreHydrator } from '@/components/layout/StoreHydrator'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })
export const metadata: Metadata = {
  title: 'YUHA - AI Development Workspace',
  description: 'A browser-based AI development workspace combining chat-driven coding, Monaco editor, terminal, live preview, and WebContainers.',
  icons: { icon: '/icon.svg' },
  openGraph: {
    title: 'YUHA - AI Development Workspace',
    description: 'A browser-based AI development workspace combining chat-driven coding, Monaco editor, terminal, live preview, and WebContainers.',
  },
}
export const viewport: Viewport = { themeColor: '#050505', colorScheme: 'dark light', width: 'device-width', initialScale: 1 }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`dark ${inter.variable} ${mono.variable}`} suppressHydrationWarning><body><StoreHydrator /><TooltipProvider>{children}<Toaster position="bottom-right" richColors /></TooltipProvider></body></html>
}

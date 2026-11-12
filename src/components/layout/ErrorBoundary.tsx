'use client'
import { Component, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() { if (this.state.hasError) return <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6"><AlertTriangle className="size-8 text-muted-foreground" /><h1 className="text-xl">Let’s get your workspace back.</h1><p className="text-center text-sm text-muted-foreground">Something unexpected happened. Your saved project is still in this browser.</p><Button onClick={() => window.location.reload()}><RotateCw data-icon="inline-start" />Reload workspace</Button></main>; return this.props.children }
}

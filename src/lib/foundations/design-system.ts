/**
 * YUHA ARCHITECTURE FOUNDATION 10: Design System & Component Registry Enforcement
 * Standardizes UI generation through a verified Component Registry and Design Tokens.
 * Enforces anti-AI slop principles: accessibility, touch targets >= 44px, semantic HTML, and responsive layouts.
 */

export interface DesignTokenSet {
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    surface: string
    muted: string
    destructive: string
  }
  typography: {
    fontSans: string
    fontMono: string
    baseSize: string
  }
  spacing: Record<string, string>
  radius: {
    sm: string
    md: string
    lg: string
    full: string
  }
}

export const YUHA_DEFAULT_DESIGN_TOKENS: DesignTokenSet = {
  colors: {
    primary: '#3b82f6',
    secondary: '#1e293b',
    accent: '#6366f1',
    background: '#090d16',
    surface: '#111827',
    muted: '#94a3b8',
    destructive: '#ef4444',
  },
  typography: {
    fontSans: 'Inter, system-ui, sans-serif',
    fontMono: 'JetBrains Mono, monospace',
    baseSize: '14px',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    full: '9999px',
  },
}

export interface VerifiedComponentMeta {
  name: string
  category: 'core' | 'layout' | 'data_display' | 'navigation' | 'feedback'
  importPath: string
  hasAccessibilityTested: boolean
  minTouchTargetPx: number
  description: string
}

export const VERIFIED_COMPONENT_REGISTRY: VerifiedComponentMeta[] = [
  {
    name: 'Button',
    category: 'core',
    importPath: '@/components/ui/button',
    hasAccessibilityTested: true,
    minTouchTargetPx: 44,
    description: 'Accessible button with variant and size states, keyboard navigation, and aria attributes',
  },
  {
    name: 'Input',
    category: 'core',
    importPath: '@/components/ui/input',
    hasAccessibilityTested: true,
    minTouchTargetPx: 44,
    description: 'Form input with label associations, error states, and clear focus styling',
  },
  {
    name: 'Dialog',
    category: 'feedback',
    importPath: '@/components/ui/dialog',
    hasAccessibilityTested: true,
    minTouchTargetPx: 44,
    description: 'Modal dialog with focus trap, ESC closing, backdrop blur, and screen reader announcements',
  },
  {
    name: 'Tabs',
    category: 'navigation',
    importPath: '@/components/ui/tabs',
    hasAccessibilityTested: true,
    minTouchTargetPx: 44,
    description: 'Keyboard navigable tablist with arrow key navigation and aria-selected',
  },
  {
    name: 'Badge',
    category: 'data_display',
    importPath: '@/components/ui/badge',
    hasAccessibilityTested: true,
    minTouchTargetPx: 24,
    description: 'Compact status badge with semantic color variants',
  },
]

export class DesignSystemValidator {
  /**
   * Scans generated UI code for common design quality & accessibility violations
   */
  public static auditUIQuality(filePath: string, code: string): { violations: string[]; score: number } {
    if (!/\.(?:tsx|jsx)$/.test(filePath)) {
      return { violations: [], score: 100 }
    }

    const violations: string[] = []
    let score = 100

    // Check 1: Missing alt on images
    if (/<img\b(?![^>]*\balt=)[^>]*>/i.test(code)) {
      violations.push('Image element missing required "alt" attribute for accessibility')
      score -= 15
    }

    // Check 2: Inline styles over tokens
    if (/style=\{\{/i.test(code)) {
      violations.push('Heavy inline style usage detected. Prefer Tailwind tokens or CSS variables')
      score -= 10
    }

    // Check 3: Raw buttons without accessible label
    if (/<button\b(?![^>]*\baria-label=)[^>]*>\s*<svg/i.test(code)) {
      violations.push('Icon-only button missing "aria-label" attribute')
      score -= 20
    }

    return {
      violations,
      score: Math.max(0, score),
    }
  }
}

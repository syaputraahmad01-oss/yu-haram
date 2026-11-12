/**
 * YUHA ARCHITECTURE FOUNDATION 13: Blueprint Proposal & Ambiguity Gate
 * Analyzes requirements before constructing complex or high-risk applications.
 * Detects ambiguity across 7 dimensions (functional, technical, scope, data,
 * integration, security, deployment) and generates structured scope contracts.
 * Avoids unnecessary friction on simple tasks.
 *
 * Master Prompt 6.1: for complex projects the gate must BLOCK generation until
 * the user approves/edits the blueprint; the approved blueprint then becomes
 * binding context for the coder. The blueprint below is derived
 * heuristically from the instruction — it is labelled as such and never
 * presented as an LLM analysis.
 */

export interface AmbiguityDimensionReport {
  dimension: 'functional' | 'technical' | 'scope' | 'data' | 'integration' | 'security' | 'deployment'
  isAmbiguous: boolean
  question?: string
  defaultAssumption: string
}

export interface WebsiteBlueprint {
  objective: string
  siteType: string
  targetUsers: string
  pages: string[]
  navigation: string
  coreFeatures: string[]
  visualDesign: string
  technology: string
  dataModel: string
  apiIntegrations: string
  dependencies: string[]
  implementationPlan: string[]
  verificationPlan: string[]
  ambiguities: AmbiguityDimensionReport[]
  /** Honest provenance marker: heuristic analysis, not an LLM product. */
  origin: 'heuristic-analyzer'
}

export interface ScopeContract {
  objective: string
  complexity: 'simple' | 'moderate' | 'complex'
  mustHaveFeatures: string[]
  excludedFeatures: string[]
  deferredFeatures: string[]
  technicalAssumptions: {
    framework: string
    language: string
    styling: string
    persistence: string
  }
  acceptanceCriteria: string[]
  ambiguities: AmbiguityDimensionReport[]
  requiresUserApproval: boolean
  blueprint: WebsiteBlueprint
}

const SITE_TYPES: Array<[RegExp, string]> = [
  [/marketplace|toko|e-?commerce|jual/i, 'Marketplace / E-commerce'],
  [/company profile|profil perusahaan|tentang kami/i, 'Company Profile'],
  [/portfolio|portofolio/i, 'Portfolio'],
  [/blog|artikel|berita|news/i, 'Blog / Situs Berita'],
  [/dashboard|admin|panel/i, 'Dashboard / Admin Panel'],
  [/saas|langganan|subscription/i, 'SaaS'],
  [/booking|reservasi|janji/i, 'Sistem Booking'],
  [/inventory|persediaan|stok/i, 'Manajemen Inventori'],
  [/crm|pelanggan|customer/i, 'CRM'],
  [/pendidikan|edukasi|course|kursus|learning/i, 'Platform Pendidikan'],
  [/landing page|promosi/i, 'Landing Page'],
]

export class BlueprintAmbiguityGate {
  /**
   * Analyzes an instruction to detect complexity, potential ambiguities and a
   * heuristic first-pass blueprint for user approval.
   */
  public static analyzePrompt(prompt: string): ScopeContract {
    const trimmed = prompt.trim().toLowerCase()
    const isComplex =
      prompt.length > 250 ||
      /(?:marketplace|full-?stack|database|auth|multi-?tenant|payment|saas|dashboard|management system|ecommerce|e-commerce|booking|inventory|crm)/i.test(
        trimmed
      )
    const isModerate =
      !isComplex &&
      (prompt.length > 80 || /(?:multi-?page|settings|form|crud|history|navigation)/i.test(trimmed))

    const complexity = isComplex ? 'complex' : isModerate ? 'moderate' : 'simple'

    const ambiguities: AmbiguityDimensionReport[] = []

    // 1. Data & Persistence
    if (/store|save|database|data|history|simpan|database/i.test(trimmed)) {
      ambiguities.push({
        dimension: 'data',
        isAmbiguous: true,
        question: 'Apakah data harus tersimpan di browser (localStorage), atau database eksternal?',
        defaultAssumption: 'Gunakan localStorage browser dengan fallback state in-memory (tanpa backend palsu).',
      })
    }

    // 2. Security & Auth
    if (/login|auth|user|role|admin|akun|pengguna/i.test(trimmed)) {
      ambiguities.push({
        dimension: 'security',
        isAmbiguous: true,
        question: 'Model autentikasi apa yang dibutuhkan: simulasi guest/mock, OAuth, atau sesi JWT lokal?',
        defaultAssumption: 'Autentikasi tersimulasi di sisi klien dengan akses berbasis role (jangan diklaim production-ready).',
      })
    }

    // 3. Integration
    if (/integrat|api|payment|pembayaran|midtrans|stripe|wa|whatsapp|email/i.test(trimmed)) {
      ambiguities.push({
        dimension: 'integration',
        isAmbiguous: true,
        question: 'Integrasi API eksternal mana yang benar-benar dibutuhkan pada versi pertama?',
        defaultAssumption: 'Siapkan lapisan integrasi dengan kredensial placeholder + instruksi konfigurasi; jangan memalsukan panggilan API aktif.',
      })
    }

    // 4. Technical Framework (default, not ambiguous)
    ambiguities.push({
      dimension: 'technical',
      isAmbiguous: false,
      defaultAssumption: 'React 19 + TypeScript + Tailwind CSS dengan arsitektur komponen modular.',
    })

    const siteType = SITE_TYPES.find(([pattern]) => pattern.test(trimmed))?.[1] ?? 'Aplikasi Web'
    const pageHints = [...trimmed.matchAll(/\b(?:halaman|page|tab|secti(?:o|ö)n)s?\b[^.,;]{0,40}/gi)].map(m => m[0].trim()).slice(0, 6)

    const blueprint: WebsiteBlueprint = {
      origin: 'heuristic-analyzer',
      objective: prompt.trim().slice(0, 240),
      siteType,
      targetUsers: /bisnis|perusahaan|company|enterprise/i.test(trimmed) ? 'Pengguna bisnis (B2B)' : 'Pengguna umum (B2C)',
      pages: pageHints.length ? pageHints : ['Beranda', ...(/login|auth|akun/i.test(trimmed) ? ['Masuk/Daftar'] : []), 'Kontak'],
      navigation: 'Navigasi atas responsif dengan menu utama dan footer',
      coreFeatures: [
        ...(/crud|tambah|edit|hapus|kelola/i.test(trimmed) ? ['CRUD data dengan validasi'] : []),
        ...(/cari|search|filter/i.test(trimmed) ? ['Pencarian dan filter'] : []),
        ...(/bayar|payment|checkout/i.test(trimmed) ? ['Alur checkout (integrasi payment belum aktif)'] : []),
        'Desain responsif desktop/tablet/mobile',
        'State loading, empty state, dan error state',
      ],
      visualDesign: 'Mengikuti design system YUHA: hierarki tipografi jelas, spacing konsisten, kontras memadai',
      technology: 'React 19 + TypeScript + Tailwind CSS (template WebContainer)',
      dataModel: /database|simpan|store|crud/i.test(trimmed)
        ? 'Entitas data didefinisikan dengan tipe TypeScript; persistensi default localStorage (lihat asumsi data)'
        : 'Tanpa persistensi data lintas sesi',
      apiIntegrations: /api|integrat|payment|wa|whatsapp|email/i.test(trimmed)
        ? 'Integrasi eksternal disiapkan sebagai lapisan terpisah dengan kredensial placeholder'
        : 'Tanpa integrasi eksternal pada versi pertama',
      dependencies: ['react', 'react-dom', 'tailwindcss'],
      implementationPlan: [
        'Struktur proyek + design token',
        'Komponen inti dan layout responsif',
        'Fitur utama per halaman',
        'Validasi input dan penanganan error',
      ],
      verificationPlan: [
        'Pemeriksaan sintaks/import (otomatis, server)',
        'Build berhasil di WebContainer',
        'Preview visual desktop + mobile',
      ],
      ambiguities,
    }

    const mustHaveFeatures = [
      'Responsive, modern UI conforming to YUHA design system',
      'Accessible interactions and semantic HTML elements',
      'Typed state management and graceful error handling',
    ]

    const acceptanceCriteria = [
      'Application builds cleanly without TypeScript or runtime errors',
      'UI is fully interactive without placeholder dead-ends',
      'Works seamlessly within the sandboxed preview environment',
    ]

    return {
      objective: prompt.slice(0, 120),
      complexity,
      mustHaveFeatures,
      excludedFeatures: ['External hosted database provisioning unless explicitly requested'],
      deferredFeatures: ['Advanced multi-region replication'],
      technicalAssumptions: {
        framework: 'React 19',
        language: 'TypeScript',
        styling: 'Tailwind CSS',
        persistence: 'localStorage',
      },
      acceptanceCriteria,
      ambiguities,
      requiresUserApproval: complexity === 'complex' && ambiguities.filter(a => a.isAmbiguous).length >= 1,
      blueprint,
    }
  }
}

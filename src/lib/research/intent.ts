/**
 * AI Research Agent intent detection (Master Prompt section 10).
 *
 * Decides whether a user prompt needs live web research BEFORE generation.
 * Deliberately conservative: static knowledge requests do not trigger search.
 */

export type ResearchIntent =
  | 'general-knowledge'   // no search needed
  | 'current-information'
  | 'technical-documentation'
  | 'coding-research'
  | 'product-or-competitor'
  | 'news'
  | 'website-content-research'

export interface IntentDecision {
  intent: ResearchIntent
  needsSearch: boolean
  reason: string
  /** Suggested focused search query (may differ from the raw prompt). */
  query: string
}

export function classifyResearchIntent(prompt: string): IntentDecision {
  const text = prompt.trim()
  const lower = text.toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)
  const explicitSearch = /\b(?:cari(?:kan)?|riset|research|search|telusuri|browse|googling|lihat di web|cek di internet|referensi terbaru)\b/.test(lower)
  const freshness = /\b(?:terbaru|terkini|updated?|sekarang|hari ini|minggu ini|bulan ini|tahun ini|20\d{2}|202[5-9]|latest|newest|current|now)\b/.test(lower)
  const news = /\b(?:berita|news|headline|tren|trending|viral|press release|peluncuran|launch)\b/.test(lower)
  const techDocs = /\b(?:dokumentasi|docs?|api reference|changelog|release notes|versi terbaru (?:dari|npm|react|next|vue|tailwind))\b/.test(lower)
  const competitor = /\b(?:kompetitor|pesaing|competitor|benchmark produk|perbandingan harga|pricing (?:dari|model)|market research|analisis pasar)\b/.test(lower)
  const coding = /\b(?:library|package|npm|framework|stack|integrasi|sdk)\b/.test(lower) && freshness

  if (news) return { intent: 'news', needsSearch: true, reason: 'Permintaan menyangkut berita/tren terkini.', query: text.slice(0, 200) }
  if (competitor) return { intent: 'product-or-competitor', needsSearch: true, reason: 'Analisis produk/pasar memerlukan data web terkini.', query: text.slice(0, 200) }
  if (techDocs) return { intent: 'technical-documentation', needsSearch: true, reason: 'Dokumentasi teknis versi terbaru diperlukan.', query: text.slice(0, 200) }
  if (coding && freshness) return { intent: 'coding-research', needsSearch: true, reason: 'Riset library/framework versi terbaru diperlukan.', query: text.slice(0, 200) }
  if (explicitSearch) return { intent: 'current-information', needsSearch: true, reason: 'Pengguna secara eksplisit meminta pencarian web.', query: text.slice(0, 200) }
  if (freshness && words.length >= 4) return { intent: 'current-information', needsSearch: true, reason: 'Informasi dinamis/mutakhir diminta.', query: text.slice(0, 200) }
  return { intent: 'general-knowledge', needsSearch: false, reason: 'Permintaan dapat dipenuhi tanpa pencarian web; riset berlebihan dihindari.', query: text.slice(0, 200) }
}

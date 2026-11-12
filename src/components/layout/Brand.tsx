import { Zap } from 'lucide-react'

export function Brand({ version = false }: { version?: boolean }) {
  return (
    <div className="brand" aria-label="YUHA">
      <div className="brand-icon-wrapper" aria-hidden="true">
        <Zap className="brand-bolt-icon" />
      </div>
      <span className="brand-name">YUHA</span>
      {version && <span className="brand-version">BETA</span>}
    </div>
  )
}

'use client'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
export function ApiKeyField({ id, value, onChange, placeholder, visible, onToggle }: { id: string; value: string; onChange: (value: string) => void; placeholder: string; visible: boolean; onToggle: () => void }) {
  return <div className="key-input-wrapper"><label htmlFor={id} className="sr-only">API key</label><Input id={id} type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} maxLength={4096} /><button aria-label={visible ? 'Hide API key' : 'Show API key'} type="button" onClick={onToggle}>{visible ? <EyeOff /> : <Eye />}</button></div>
}

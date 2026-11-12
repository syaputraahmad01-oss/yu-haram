'use client'

import dynamic from 'next/dynamic'
import type { BeforeMount } from '@monaco-editor/react'
import { useAppStore } from '@/lib/store/useAppStore'
import { getFileLanguage } from '@/lib/utils/file-helpers'

const MonacoEditor = dynamic(() => import('@monaco-editor/react').then(module => module.default), {
  ssr: false,
})

const defineYuhaTheme: BeforeMount = monaco => {
  monaco.editor.defineTheme('yuha-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#151619',
      'editorLineNumber.foreground': '#62646b',
      'editorLineNumber.activeForeground': '#d5d7dc',
      'editorCursor.foreground': '#a78bfa',
      'editor.selectionBackground': '#51417a66',
    },
  })
}

interface MonacoEditorWrapperProps {
  path: string
  value: string
  onChange: (content: string) => void
}

export function MonacoEditorWrapper({ path, value, onChange }: MonacoEditorWrapperProps) {
  const theme = useAppStore(state => state.theme)
  const fallback = (
    <textarea
      aria-label={`Edit ${path}`}
      className="editor-fallback"
      value={value}
      onChange={event => onChange(event.target.value)}
      spellCheck={false}
    />
  )

  return (
    <div className="monaco-container">
      <MonacoEditor
        path={path}
        value={value}
        language={getFileLanguage(path)}
        theme={theme === 'dark' ? 'yuha-dark' : 'light'}
        loading={fallback}
        beforeMount={defineYuhaTheme}
        onChange={nextValue => onChange(nextValue ?? '')}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'JetBrains Mono, monospace',
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: 'on',
          padding: { top: 16, bottom: 16 },
          ariaLabel: `Code editor for ${path}`,
        }}
      />
    </div>
  )
}

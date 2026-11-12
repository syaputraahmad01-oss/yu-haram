'use client'
import dynamic from 'next/dynamic'
const SettingsPage = dynamic(() => import('@/components/settings/SettingsPage'), { ssr: false })
export default function SettingsRoute() { return <SettingsPage /> }

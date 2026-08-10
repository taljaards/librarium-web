// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 fireball1725

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useToast } from './Toast'
import { downloadAuthenticated, DownloadError, EXPORT_FORMATS, type ExportFormat } from '../lib/download'

interface ExportButtonProps {
  /** Returns the export URL for a format. Called at click time so the
   *  current search / filter state is captured, not the state at mount. */
  urlFor: (format: ExportFormat) => string
  /** Filename used when the server sends no Content-Disposition. */
  fallbackName: string
  /** What's being exported, for the "Exported N books" style toast. */
  label?: string
  /** Compact renders an icon-only trigger for tight toolbars. */
  compact?: boolean
  /** Disables the trigger — e.g. when the current view has no rows. */
  disabled?: boolean
  className?: string
}

/**
 * Download control offering the export formats the API supports.
 *
 * Every export in the app goes through this so the formats, the busy state
 * and the failure toast behave the same everywhere; callers only supply the
 * URL for the view being exported.
 */
export default function ExportButton({
  urlFor,
  fallbackName,
  label = 'Export',
  compact = false,
  disabled = false,
  className = '',
}: ExportButtonProps) {
  const { getToken } = useAuth()
  const { show: showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function run(format: ExportFormat) {
    setOpen(false)
    setBusy(true)
    try {
      await downloadAuthenticated(getToken, urlFor(format), `${fallbackName}.${format}`)
    } catch (err) {
      showToast(err instanceof DownloadError ? err.message : 'Export failed', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const trigger = compact
    ? 'rounded-lg border border-gray-300 dark:border-gray-600 px-2.5 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50'
    : 'rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center gap-2'

  return (
    <div className={`relative flex-shrink-0 ${className}`} ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? 'Nothing to export' : `${label} — downloads what you're currently viewing`}
        className={trigger}>
        {busy ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        )}
        {!compact && <span>{busy ? 'Exporting…' : label}</span>}
      </button>

      {open && (
        <div role="menu"
          className="absolute right-0 top-full mt-1 z-30 w-52 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1">
          {EXPORT_FORMATS.map(({ format, label: formatLabel, hint }) => (
            <button key={format} type="button" role="menuitem"
              aria-label={`Export as ${formatLabel}`} onClick={() => run(format)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <span className="block text-sm text-gray-700 dark:text-gray-300">{formatLabel}</span>
              <span className="block text-xs text-gray-400 dark:text-gray-500">{hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

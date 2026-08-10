// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 fireball1725

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthenticatedImage } from '../../hooks/useAuthenticatedImage'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import BookCover from '../../components/BookCover'
import ExportButton from '../../components/ExportButton'
import { booksExportUrl, quoteQueryValue } from '../../lib/download'
import type { LibraryOutletContext } from '../../components/LibraryOutlet'
import type {
  Book,
  ContributorDetail,
  ContributorWork,
  ExternalContributorCandidate,
  ExternalContributorData,
} from '../../types'

// ─── ContributorAvatar (exported for ContributorsPage) ────────────────────────

function ContributorAvatar({ photoUrl, name, size }: { photoUrl: string | null; name: string; size?: 'sm' | 'lg' }) {
  const src = useAuthenticatedImage(photoUrl)
  const [error, setError] = useState(false)
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const lg = size === 'lg'
  if (src && !error) {
    return (
      <img src={src} alt={name} onError={() => setError(true)}
        className={`rounded-full object-cover flex-shrink-0 ${lg ? 'w-16 h-16' : 'w-8 h-8'}`} />
    )
  }
  return (
    <div className={`rounded-full flex-shrink-0 flex items-center justify-center bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold ${lg ? 'w-16 h-16 text-xl' : 'w-8 h-8 text-xs'}`}>
      {initials || '?'}
    </div>
  )
}

export { ContributorAvatar }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatYear(iso: string | null | undefined): string {
  if (!iso) return ''
  try { return new Date(iso).getFullYear().toString() } catch { return '' }
}

// ─── Section (matches BookPage) ───────────────────────────────────────────────

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 10) // "YYYY-MM-DD" for <input type="date">
}

function EditContributorModal({ contributorId, contributor, onClose, onSaved }: {
  contributorId: string
  contributor: ContributorDetail
  onClose: () => void
  onSaved: () => void
}) {
  const { callApi } = useAuth()
  const [name, setName] = useState(contributor.name)
  const [sortName, setSortName] = useState(contributor.sort_name || '')
  const [isCorporate, setIsCorporate] = useState(contributor.is_corporate)
  const [bio, setBio] = useState(contributor.bio || '')
  const [bornDate, setBornDate] = useState(toDateInput(contributor.born_date))
  const [diedDate, setDiedDate] = useState(toDateInput(contributor.died_date))
  const [nationality, setNationality] = useState(contributor.nationality || '')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await callApi(`/api/v1/contributors/${contributorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          sort_name: sortName,
          is_corporate: isCorporate,
          bio,
          born_date: bornDate,
          died_date: diedDate,
          nationality,
        }),
      })
      onSaved()
      onClose()
    } finally { setSaving(false) }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  const labelCls = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-16 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Edit contributor</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className={labelCls}>Name</label>
            <input ref={nameRef} type="text" value={name} onChange={e => setName(e.target.value)} required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>
              Sort name <span className="text-gray-400 font-normal">— e.g. "Gaiman, Neil" (leave blank to auto-derive)</span>
            </label>
            <input type="text" value={sortName} onChange={e => setSortName(e.target.value)}
              placeholder={isCorporate ? name : 'auto-derived from name'}
              className={inputCls} />
          </div>
          <div className="flex items-center gap-2">
            <input id="is-corporate" type="checkbox" checked={isCorporate}
              onChange={e => setIsCorporate(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
            <label htmlFor="is-corporate" className="text-sm text-gray-700 dark:text-gray-300">
              Corporate entity (publisher, studio, etc.) — don't invert name for sorting
            </label>
          </div>
          <div>
            <label className={labelCls}>Bio</label>
            <textarea value={bio} onChange={e => setBio(e.target.value)} rows={5}
              className={`${inputCls} resize-y`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Born</label>
              <input type="date" value={bornDate} onChange={e => setBornDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Died</label>
              <input type="date" value={diedDate} onChange={e => setDiedDate(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Nationality</label>
            <input type="text" value={nationality} onChange={e => setNationality(e.target.value)} className={inputCls} />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving || !name.trim()}
              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Metadata modal ───────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  hardcover: 'Hardcover',
  open_library: 'Open Library',
  openlibrary: 'Open Library',
}

function ContributorMetadataModal({ contributor, onClose, onApplied }: {
  contributor: ContributorDetail; onClose: () => void; onApplied: () => void
}) {
  const { callApi } = useAuth()

  // Search phase
  const [query, setQuery] = useState(contributor.name)
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<ExternalContributorCandidate[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Fetch phase
  const [fetchTarget, setFetchTarget] = useState<ExternalContributorCandidate | null>(null)
  const [fetchData, setFetchData] = useState<ExternalContributorData | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Apply phase
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  // Auto-search on open
  useEffect(() => { doSearch() }, []) // eslint-disable-line

  const doSearch = async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    setCandidates(null)
    setFetchTarget(null)
    setFetchData(null)
    try {
      const results = await callApi<ExternalContributorCandidate[]>(
        `/api/v1/lookup/contributors?q=${encodeURIComponent(q)}`
      )
      setCandidates(results ?? [])
    } catch {
      setSearchError('Search failed. Check your provider settings.')
    } finally {
      setSearching(false)
    }
  }

  const doFetch = async (c: ExternalContributorCandidate) => {
    setFetchTarget(c)
    setFetching(true)
    setFetchError(null)
    setFetchData(null)
    try {
      const data = await callApi<ExternalContributorData>(
        `/api/v1/contributors/${contributor.id}/metadata/fetch?provider=${encodeURIComponent(c.provider)}&external_id=${encodeURIComponent(c.external_id)}`
      )
      if (!data) { setFetchError('No data returned.'); return }
      setFetchData(data)

      // Auto-select fields that differ from current values
      const next = new Set<string>()
      if (data.bio && data.bio !== contributor.bio) next.add('bio')
      if (data.born_date && data.born_date !== contributor.born_date) next.add('born_date')
      if (data.died_date && data.died_date !== contributor.died_date) next.add('died_date')
      if (data.nationality && data.nationality !== contributor.nationality) next.add('nationality')
      if (data.photo_url && !contributor.photo_url) next.add('photo')
      if (data.works && data.works.length > 0) next.add('works')
      setEnabled(next)
    } catch {
      setFetchError('Failed to fetch details from provider.')
    } finally {
      setFetching(false)
    }
  }

  const doApply = async () => {
    if (!fetchData) return
    setApplying(true)
    setApplyError(null)
    try {
      const body: Record<string, unknown> = {
        provider: fetchData.provider,
        external_id: fetchData.external_id,
      }
      if (enabled.has('bio'))          body.bio          = fetchData.bio
      if (enabled.has('born_date'))    body.born_date    = fetchData.born_date
      if (enabled.has('died_date'))    body.died_date    = fetchData.died_date
      if (enabled.has('nationality'))  body.nationality  = fetchData.nationality
      if (enabled.has('photo'))        body.photo_url    = fetchData.photo_url
      if (enabled.has('works'))        body.works        = fetchData.works
      await callApi(`/api/v1/contributors/${contributor.id}/metadata/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onApplied()
      onClose()
    } catch {
      setApplyError('Failed to apply changes.')
    } finally {
      setApplying(false)
    }
  }

  const toggle = (key: string) =>
    setEnabled(prev => { const s = new Set(prev); if (s.has(key)) s.delete(key); else s.add(key); return s })

  // Build field comparison rows
  const fields: Array<{ key: string; label: string; current: string; proposed: string; multiline?: boolean }> = fetchData
    ? [
        { key: 'bio',         label: 'Bio',         current: contributor.bio || '',          proposed: fetchData.bio || '',         multiline: true },
        { key: 'born_date',   label: 'Born',         current: formatYear(contributor.born_date), proposed: formatYear(fetchData.born_date) },
        { key: 'died_date',   label: 'Died',         current: formatYear(contributor.died_date), proposed: formatYear(fetchData.died_date) },
        { key: 'nationality', label: 'Nationality',  current: contributor.nationality || '',  proposed: fetchData.nationality || '' },
        { key: 'photo',       label: 'Photo',        current: contributor.photo_url ? 'Has photo' : 'No photo', proposed: fetchData.photo_url ? 'New photo available' : '' },
        { key: 'works',       label: 'Bibliography', current: `${contributor.works.length} works`, proposed: fetchData.works.length > 0 ? `${fetchData.works.length} works from ${PROVIDER_LABELS[fetchData.provider] ?? fetchData.provider}` : '' },
      ].filter(f => f.proposed !== '')
    : []

  const selectedCount = fields.filter(f => enabled.has(f.key)).length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-16 px-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl bg-white dark:bg-gray-900 shadow-xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Refresh metadata</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Search bar */}
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              placeholder="Search by name…"
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button onClick={doSearch} disabled={searching || !query.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {searching ? '…' : 'Search'}
            </button>
          </div>

          {searchError && <p className="text-sm text-red-600 dark:text-red-400">{searchError}</p>}
          {searching && <p className="text-sm text-gray-400 dark:text-gray-500">Searching providers…</p>}

          {/* Candidate list */}
          {candidates !== null && !fetchData && (
            candidates.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No results found.</p>
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
                {candidates.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => doFetch(c)}
                    disabled={fetching && fetchTarget?.external_id === c.external_id}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    {c.photo_url ? (
                      <img src={c.photo_url} alt={c.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-sm font-semibold">
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {PROVIDER_LABELS[c.provider] ?? c.provider}
                      </p>
                    </div>
                    {fetching && fetchTarget?.external_id === c.external_id
                      ? <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      : <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    }
                  </button>
                ))}
              </div>
            )
          )}

          {fetchError && <p className="text-sm text-red-600 dark:text-red-400">{fetchError}</p>}

          {/* Field rows */}
          {fetchData && (
            <>
              {/* Back link */}
              <button onClick={() => { setFetchData(null); setFetchTarget(null) }}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to results
              </button>

              {/* Provider header */}
              <div className="flex items-center gap-3">
                {fetchData.photo_url && (
                  <img src={fetchData.photo_url} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{fetchData.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {PROVIDER_LABELS[fetchData.provider] ?? fetchData.provider}
                  </p>
                </div>
              </div>

              {/* Field comparison rows */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {fields.map(fd => {
                    const isSame = fd.proposed === fd.current
                    const isOn = enabled.has(fd.key)
                    return (
                      <div key={fd.key} className={`flex items-start gap-3 px-4 py-3 ${isSame ? 'opacity-50' : ''}`}>
                        <input type="checkbox"
                          checked={isOn && !isSame}
                          disabled={isSame}
                          onChange={() => !isSame && toggle(fd.key)}
                          className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
                            {fd.label}
                          </p>
                          {isSame ? (
                            <p className={`text-sm text-gray-500 dark:text-gray-400 ${fd.multiline ? 'line-clamp-2' : 'truncate'}`}>
                              {fd.current || '(empty)'}
                            </p>
                          ) : (
                            <div className="space-y-0.5">
                              {fd.current && (
                                <p className={`text-xs text-gray-400 dark:text-gray-500 line-through ${fd.multiline ? 'line-clamp-1' : 'truncate'}`}>
                                  {fd.current}
                                </p>
                              )}
                              <p className={`text-sm text-gray-800 dark:text-gray-200 ${fd.multiline ? 'line-clamp-3' : 'truncate'}`}>
                                {fd.proposed}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {applyError && <p className="text-sm text-red-600 dark:text-red-400">{applyError}</p>}

              <button
                onClick={doApply}
                disabled={applying || selectedCount === 0}
                className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {applying ? 'Applying…' : `Apply ${selectedCount} change${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Library books grid ───────────────────────────────────────────────────────

function LibraryBooksList({ books, libraryId }: { books: Book[]; libraryId: string }) {
  const showReadBadges = localStorage.getItem('librarium:show_read_badges') !== 'false'
  if (books.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500">No books by this contributor in the library yet.</p>
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
      {books.map(b => (
        <Link key={b.id} to={`/libraries/${libraryId}/books/${b.id}`} className="group flex flex-col gap-1.5">
          <BookCover title={b.title} coverUrl={b.cover_url} className="w-full" readStatus={showReadBadges ? b.user_read_status : undefined} />
          <p className="text-xs font-medium text-gray-900 dark:text-white line-clamp-2 leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors px-0.5">
            {b.title}
          </p>
        </Link>
      ))}
    </div>
  )
}

// ─── Bibliography grid ────────────────────────────────────────────────────────

const PREVIEW_COUNT = 12

function WorksList({ works, libraryId, onDelete }: { works: ContributorWork[]; libraryId: string; onDelete: (id: string) => void }) {
  const navigate = useNavigate()
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? works : works.slice(0, PREVIEW_COUNT)

  if (works.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500">No bibliography entries yet. Use the refresh metadata button to enrich this contributor.</p>
  }

  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
        {visible.map(w => (
          <div key={w.id} className={`group relative flex flex-col gap-1.5 ${w.in_library ? '' : 'opacity-60'}`}>
            {/* Cover */}
            <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800">
              {w.cover_url ? (
                <img src={w.cover_url} alt={w.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-gray-600">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
              )}
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 p-1">
                {w.in_library && w.library_book_id ? (
                  <Link to={`/libraries/${libraryId}/books/${w.library_book_id}`}
                    className="w-full text-center text-xs font-medium bg-white/90 text-gray-900 rounded px-1.5 py-1 hover:bg-white transition-colors">
                    View
                  </Link>
                ) : (
                  <button
                    onClick={() => {
                      const isbn = w.isbn_13 || w.isbn_10
                      navigate(`/libraries/${libraryId}/books`, { state: { openAdd: true, isbn: isbn || '', title: w.title } })
                    }}
                    className="w-full text-xs font-medium bg-blue-600/90 text-white rounded px-1.5 py-1 hover:bg-blue-600 transition-colors"
                  >
                    Add
                  </button>
                )}
                <button onClick={() => onDelete(w.id)}
                  className="w-full text-xs text-white/80 hover:text-white transition-colors">
                  Remove
                </button>
              </div>
            </div>
            {/* Title */}
            <div className="min-w-0 px-0.5">
              <p className="text-xs font-medium text-gray-900 dark:text-white line-clamp-2 leading-snug">
                {w.in_library && w.library_book_id ? (
                  <Link to={`/libraries/${libraryId}/books/${w.library_book_id}`}
                    className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    {w.title}
                  </Link>
                ) : w.title}
              </p>
              {w.publish_year && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{w.publish_year}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {works.length > PREVIEW_COUNT && (
        <button onClick={() => setShowAll(s => !s)}
          className="mt-4 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          {showAll ? 'Show fewer' : `Show all ${works.length} works`}
        </button>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ContributorPage() {
  const { libraryId, contributorId } = useParams<{ libraryId: string; contributorId: string }>()
  const { setExtraCrumbs } = useOutletContext<LibraryOutletContext>()
  const { callApi } = useAuth()

  const [contributor, setContributor] = useState<ContributorDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [showMetaModal, setShowMetaModal] = useState(false)
  const sidebarPhotoSrc = useAuthenticatedImage(contributor?.photo_url ?? null)

  const photoInputRef = useRef<HTMLInputElement>(null)

  // ── Load ─────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!libraryId || !contributorId) return
    setLoading(true)
    try {
      const data = await callApi<ContributorDetail>(
        `/api/v1/libraries/${libraryId}/contributors/${contributorId}`
      )
      setContributor(data)
    } catch {
      setContributor(null)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, contributorId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!contributor) return
    setExtraCrumbs([
      { label: 'Contributors', to: `/libraries/${libraryId}/contributors` },
      { label: contributor.name },
    ])
    return () => setExtraCrumbs([])
  }, [contributor, libraryId, setExtraCrumbs])

  // ── Photo upload ──────────────────────────────────────────────────────────────
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoUploading(true)
    try {
      const form = new FormData()
      form.append('photo', file)
      await callApi(`/api/v1/contributors/${contributorId}/photo`, { method: 'PUT', body: form })
      load()
    } finally {
      setPhotoUploading(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  const handlePhotoDelete = async () => {
    if (!confirm('Remove photo?')) return
    setPhotoUploading(true)
    try {
      await callApi(`/api/v1/contributors/${contributorId}/photo`, { method: 'DELETE' })
      load()
    } finally { setPhotoUploading(false) }
  }

  // ── Work delete ───────────────────────────────────────────────────────────────
  const deleteWork = async (workId: string) => {
    if (!confirm('Remove this bibliography entry?')) return
    try {
      await callApi(`/api/v1/contributors/${contributorId}/works/${workId}`, { method: 'DELETE' })
      setContributor(c => c ? { ...c, works: c.works.filter(w => w.id !== workId) } : c)
    } catch { /* non-fatal */ }
  }

  // ── Loading / not found ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!contributor) {
    return <div className="p-8 text-sm text-gray-400 dark:text-gray-500">Contributor not found.</div>
  }

  const externalLinks: Array<{ label: string; url: string }> = []
  if (contributor.external_ids?.open_library)
    externalLinks.push({ label: 'Open Library', url: `https://openlibrary.org/authors/${contributor.external_ids.open_library}` })
  if (contributor.external_ids?.hardcover)
    externalLinks.push({ label: 'Hardcover', url: `https://hardcover.app/authors/${contributor.external_ids.hardcover}` })

  return (
    <div className="p-8">
      <div className="flex gap-8 items-start">

        {/* ── Left sidebar ── */}
        <div className="w-48 flex-shrink-0 sticky top-8 space-y-5">

          {/* Photo with upload overlay */}
          <div className="relative group cursor-pointer"
            onClick={() => !photoUploading && photoInputRef.current?.click()}>
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
            {sidebarPhotoSrc ? (
              <img
                src={sidebarPhotoSrc}
                alt={contributor.name}
                className="w-full aspect-square rounded-xl object-cover"
              />
            ) : (
              <div className="w-full aspect-square rounded-xl flex items-center justify-center bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-4xl font-bold">
                {contributor.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" disabled={photoUploading}
                onClick={e => { e.stopPropagation(); photoInputRef.current?.click() }}
                className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-white disabled:opacity-50 transition-colors">
                {photoUploading ? 'Uploading…' : contributor.photo_url ? 'Change photo' : 'Add photo'}
              </button>
              {contributor.photo_url && !photoUploading && (
                <button type="button"
                  onClick={e => { e.stopPropagation(); handlePhotoDelete() }}
                  className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-white transition-colors">
                  Remove
                </button>
              )}
            </div>
          </div>

          {/* Metadata facts */}
          {(contributor.born_date || contributor.died_date || contributor.nationality) && (
            <dl className="space-y-2.5">
              {contributor.born_date && (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-gray-500">Born</dt>
                  <dd className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{formatYear(contributor.born_date)}</dd>
                </div>
              )}
              {contributor.died_date && (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-gray-500">Died</dt>
                  <dd className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{formatYear(contributor.died_date)}</dd>
                </div>
              )}
              {contributor.nationality && (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-gray-500">Nationality</dt>
                  <dd className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{contributor.nationality}</dd>
                </div>
              )}
            </dl>
          )}

          {/* External links */}
          {externalLinks.length > 0 && (
            <div className="space-y-1.5">
              {externalLinks.map(l => (
                <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                  {l.label}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* ── Right main column ── */}
        <div className="flex-1 min-w-0">

          {/* Name row */}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">
              {contributor.name}
            </h1>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => setShowRename(true)} title="Rename"
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button onClick={() => setShowMetaModal(true)} title="Refresh metadata"
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* Bio */}
          {contributor.bio && (
            <Section title="About">
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                {contributor.bio}
              </p>
            </Section>
          )}

          {/* Books in library */}
          <Section
            title={`Books in Library${contributor.books.length > 0 ? ` (${contributor.books.length})` : ''}`}
            action={contributor.books.length > 0 && (
              // Same contributor filter the books list uses, so this exports
              // exactly the titles shown below.
              <ExportButton
                urlFor={format => booksExportUrl(libraryId!, format, {
                  q: `contributor:${quoteQueryValue(contributor.name)}`,
                  sort: 'title',
                })}
                fallbackName={`books-by-${contributor.name}`}
                compact
              />
            )}
          >
            <LibraryBooksList books={contributor.books} libraryId={libraryId!} />
          </Section>

          {/* Bibliography */}
          <Section
            title={`Bibliography${contributor.works.length > 0 ? ` (${contributor.works.length})` : ''}`}
          >
            <WorksList works={contributor.works} libraryId={libraryId!} onDelete={deleteWork} />
          </Section>

        </div>
      </div>

      {/* ── Modals ── */}
      {showRename && (
        <EditContributorModal
          contributorId={contributorId!}
          contributor={contributor}
          onClose={() => setShowRename(false)}
          onSaved={load}
        />
      )}
      {showMetaModal && (
        <ContributorMetadataModal
          contributor={contributor}
          onClose={() => setShowMetaModal(false)}
          onApplied={load}
        />
      )}
    </div>
  )
}

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useOutletContext, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, ApiError } from '../../auth/AuthContext'
import type { Crumb, LibraryOutletContext } from '../../components/LibraryOutlet'
import type { LibraryMember, Book, PagedBooks, MediaType, ContributorResult, Tag, Shelf, Loan, Series, SeriesArc, SeriesEntry, SeriesPreviewBook, SeriesVolume, SeriesMatchCandidate, SeriesSuggestion, ISBNLookupResult, SeriesLookupResult, Genre, AIMetadataProposal, SeriesMetadataPayload, SeriesArcsPayload } from '../../types'
import { useAuthenticatedImage } from '../../hooks/useAuthenticatedImage'
import { LANGUAGE_OPTIONS } from '../../components/AddEditionModal'
import BookCover, { BookCoverThumb } from '../../components/BookCover'
import { useToast } from '../../components/Toast'
import ContributorRow, { CONTRIBUTOR_ROLES } from '../../components/ContributorRow'
import MediaTypeSelect from '../../components/MediaTypeSelect'
import EmojiPicker from '../../components/EmojiPicker'
import EditBookModal from '../../components/EditBookModal'
import LoanFormModal from '../../components/LoanFormModal'
import ExportButton from '../../components/ExportButton'
import { booksExportUrl, loansExportUrl } from '../../lib/download'
import {
  allConditions,
  conditionLabel,
  displayLanguage,
  parseSearchQuery,
  removeFromQuery,
  upsertQueryToken,
} from '../../lib/search'

// ─── Manga publisher detection ────────────────────────────────────────────────

const MANGA_PUBLISHERS = ['viz', 'yen press', 'kodansha', 'seven seas', 'tokyopop', 'square enix manga', 'dark horse manga', 'vertical', 'j-novel', 'cross infinite']

// ─── ISBN result helpers ──────────────────────────────────────────────────────

const TOTAL_ISBN_FIELDS = 11

function countISBNFields(r: ISBNLookupResult): number {
  return [
    !!r.title, !!r.subtitle, (r.authors?.length ?? 0) > 0,
    !!r.publisher, !!r.publish_date, !!r.isbn_10, !!r.isbn_13,
    !!r.description, !!r.language, r.page_count != null, !!r.cover_url,
  ].filter(Boolean).length
}

// BarcodeDetector is a browser API not yet in TypeScript's lib
declare class BarcodeDetector {
  constructor(options?: { formats: string[] })
  detect(image: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>
  static getSupportedFormats(): Promise<string[]>
}

interface UserResult {
  id: string
  username: string
  display_name: string
  email: string
}

// ─── Add Member modal ─────────────────────────────────────────────────────────

interface AddMemberModalProps {
  libraryId: string
  onClose: () => void
  onAdded: () => void
}

function AddMemberModal({ libraryId, onClose, onAdded }: AddMemberModalProps) {
  const { callApi } = useAuth()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [selected, setSelected] = useState<UserResult | null>(null)
  const [role, setRole] = useState('library_viewer')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected || query.length < 2) { setResults([]); setShowDropdown(false); return }
    const t = setTimeout(async () => {
      try {
        const users = await callApi<UserResult[]>(`/api/v1/users?q=${encodeURIComponent(query)}`)
        setResults(users ?? [])
        setShowDropdown(true)
      } catch { setResults([]) }
    }, 250)
    return () => clearTimeout(t)
  }, [query, selected, callApi])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return
    setError(null); setIsLoading(true)
    try {
      await callApi(`/api/v1/libraries/${libraryId}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_id: selected.id, role }),
      })
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add member')
    } finally { setIsLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-900 shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add member</h2>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div ref={searchRef} className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">User</label>
            {selected ? (
              <div className="flex items-center gap-2 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
                <span className="flex-1 text-sm text-gray-900 dark:text-white">
                  <span className="font-medium">{selected.display_name}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-1">@{selected.username}</span>
                </span>
                <button type="button" onClick={() => { setSelected(null); setQuery('') }}
                  className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
              </div>
            ) : (
              <input type="text" autoFocus value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => results.length > 0 && setShowDropdown(true)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Search by name, username, or email…" />
            )}
            {showDropdown && results.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
                {results.map(u => (
                  <li key={u.id}>
                    <button type="button" onMouseDown={e => e.preventDefault()}
                      onClick={() => { setSelected(u); setQuery(''); setShowDropdown(false) }}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{u.display_name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">@{u.username} · {u.email}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showDropdown && results.length === 0 && query.length >= 2 && !selected && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
                No users found
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="library_owner">Owner</option>
              <option value="library_editor">Editor</option>
              <option value="library_viewer">Viewer</option>
            </select>
          </div>
          {error && <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-400">{error}</div>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Cancel</button>
            <button type="submit" disabled={isLoading || !selected}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {isLoading ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Add Book modal ───────────────────────────────────────────────────────────

interface BookFormContributor {
  contributor: ContributorResult | null
  role: string
}

interface AddBookModalProps {
  libraryId: string
  mediaTypes: MediaType[]
  onClose: () => void
  onSaved: (book: Book) => void
  /** Called when an ISBN scan finds a book already in the library. */
  onDuplicate?: (book: Book) => void
  /** Pre-fill and auto-trigger an ISBN lookup when the modal opens. */
  initialIsbn?: string
  /** Pre-fill the title search and auto-search when there is no ISBN. */
  initialTitle?: string
}

function AddBookModal({ libraryId, mediaTypes, onClose, onSaved, onDuplicate, initialIsbn, initialTitle }: AddBookModalProps) {
  const { callApi } = useAuth()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    media_type_id: mediaTypes.find(mt => mt.name === 'novel')?.id ?? mediaTypes[0]?.id ?? '',
    description: '',
  })
  const [contributors, setContributors] = useState<BookFormContributor[]>([])
  const [selectedTags, setSelectedTags] = useState<Tag[]>([])
  const [libraryTags, setLibraryTags] = useState<Tag[]>([])
  const [tagQuery, setTagQuery] = useState('')
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false)
  const [newTagColor, setNewTagColor] = useState('#3b82f6')
  const [isCreatingTag, setIsCreatingTag] = useState(false)
  const tagInputRef = useRef<HTMLInputElement>(null)

  const [selectedGenres, setSelectedGenres] = useState<Genre[]>([])
  const [allGenres, setAllGenres] = useState<Genre[]>([])
  const [genreQuery, setGenreQuery] = useState('')
  const [genreDropdownOpen, setGenreDropdownOpen] = useState(false)
  const genreInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    callApi<Tag[]>(`/api/v1/libraries/${libraryId}/tags`)
      .then(ts => setLibraryTags(ts ?? []))
      .catch(() => {})
    callApi<Genre[]>('/api/v1/genres')
      .then(gs => setAllGenres(gs ?? []))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId])

  const [allShelves, setAllShelves] = useState<Shelf[]>([])
  const [selectedShelfIds, setSelectedShelfIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    callApi<Shelf[]>(`/api/v1/libraries/${libraryId}/shelves`)
      .then(ss => setAllShelves(ss ?? []))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId])

  // Edition section — open by default when adding a new book
  const [showEdition, setShowEdition] = useState(true)
  const [edition, setEdition] = useState({
    format: 'paperback',
    edition_name: '',
    language: '',
    publisher: '',
    publish_date: '',
    isbn_10: '',
    isbn_13: '',
    page_count: '',
    duration_hours: '',
    duration_minutes: '',
    narrator: '',
    is_primary: true,
  })

  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [pendingCoverUrl, setPendingCoverUrl] = useState<string | null>(null)

  // ─── ISBN lookup mode ──────────────────────────────────────────────────────
  const [mode, setMode] = useState<'isbn' | 'search' | 'manual'>(!initialIsbn && initialTitle ? 'search' : 'isbn')
  const [isbnInput, setIsbnInput] = useState(initialIsbn ?? '')
  const [isbnResults, setIsbnResults] = useState<ISBNLookupResult[]>([])
  const [isbnLoading, setIsbnLoading] = useState(false)
  const [isbnError, setIsbnError] = useState<string | null>(null)
  const [isbnDuplicate, setIsbnDuplicate] = useState<Book | null>(null)
  const [scanning, setScanning] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const isbnInputRef = useRef<HTMLInputElement>(null)

  // ─── Freetext book search mode ─────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState((!initialIsbn && initialTitle) ? initialTitle : '')
  const [searchResults, setSearchResults] = useState<ISBNLookupResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchProgress, setSearchProgress] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!searchLoading) { setSearchProgress(0); return }
    setSearchProgress(0)
    let current = 0
    let tid: ReturnType<typeof setTimeout>
    const step = () => {
      const remaining = 90 - current
      if (remaining < 1) return
      current = Math.min(current + (Math.random() * 0.18 + 0.04) * remaining, 90)
      setSearchProgress(Math.round(current))
      tid = setTimeout(step, 300 + Math.random() * 900)
    }
    tid = setTimeout(step, 120)
    return () => clearTimeout(tid)
  }, [searchLoading])

  const doBookSearch = async (query: string) => {
    if (!query.trim()) return
    setSearchLoading(true)
    setSearchError(null)
    setSearchResults([])
    try {
      const results = await callApi<ISBNLookupResult[]>(`/api/v1/lookup/books?q=${encodeURIComponent(query.trim())}`)
      setSearchResults(results ?? [])
      if (!results || results.length === 0) setSearchError('No results found.')
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : 'Unable to retrieve results — please try again later.')
    } finally {
      setSearchLoading(false)
    }
  }

  const stopScan = () => {
    setScanning(false)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const startScan = async () => {
    if (!('BarcodeDetector' in window)) {
      setIsbnError('Barcode scanning is not supported in this browser.')
      return
    }
    setIsbnError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      setScanning(true)
      // Give React time to render the video element
      setTimeout(async () => {
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] })
        const scan = async () => {
          if (!videoRef.current || !streamRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes.length > 0) {
              const code = codes[0].rawValue
              stopScan()
              setIsbnInput(code)
              doISBNLookup(code)
            } else {
              requestAnimationFrame(scan)
            }
          } catch {
            requestAnimationFrame(scan)
          }
        }
        scan()
      }, 100)
    } catch {
      setIsbnError('Camera access denied or unavailable.')
    }
  }

  // Auto-trigger lookup when modal opens with a pre-filled ISBN or title
  useEffect(() => {
    if (initialIsbn) doISBNLookup(initialIsbn)
    else if (initialTitle) doBookSearch(initialTitle)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Focus the relevant input whenever the active mode changes (and when a
  // barcode scan is cancelled, which remounts the ISBN input).
  useEffect(() => {
    if (mode === 'isbn') {
      if (!scanning) isbnInputRef.current?.focus()
    } else if (mode === 'search') {
      searchInputRef.current?.focus()
    } else if (mode === 'manual') {
      titleInputRef.current?.focus()
    }
  }, [mode, scanning])

  // Function declaration, not a const arrow: the barcode-scan callback above
  // and the auto-trigger effect both call this before this line is reached.
  // A hoisted declaration has no temporal dead zone and no stale-closure
  // hazard, since the binding never gets reassigned.
  async function doISBNLookup(isbn: string) {
    if (!isbn.trim()) return
    setIsbnLoading(true)
    setIsbnError(null)
    setIsbnResults([])
    setIsbnDuplicate(null)
    const cleanISBN = isbn.trim()
    try {
      const [results, duplicate] = await Promise.all([
        callApi<ISBNLookupResult[]>(`/api/v1/lookup/isbn/${encodeURIComponent(cleanISBN)}`),
        callApi<Book>(`/api/v1/libraries/${libraryId}/book-by-isbn/${encodeURIComponent(cleanISBN)}`).catch(() => null),
      ])
      setIsbnResults(results ?? [])
      setIsbnDuplicate(duplicate ?? null)
      if (duplicate) onDuplicate?.(duplicate)
      if (!results || results.length === 0) {
        setIsbnError('No results found for that ISBN.')
      }
    } catch (err) {
      setIsbnError(err instanceof ApiError ? err.message : 'Lookup failed')
    } finally {
      setIsbnLoading(false)
    }
  }

  const importResult = async (result: ISBNLookupResult) => {
    const novelId = mediaTypes.find(mt => mt.name === 'novel')?.id
    const mangaId = mediaTypes.find(mt => mt.name === 'manga')?.id
    const comicId = mediaTypes.find(mt => mt.name === 'comic')?.id

    // Auto-detect media type from provider categories and publisher
    const categories = (result.categories ?? []).map(c => c.toLowerCase())
    const publisher = (result.publisher ?? '').toLowerCase()
    const isMangaCategory = categories.some(c => /manga|manhwa|manhua/.test(c))
    const isComicCategory = categories.some(c => /comic|graphic novel/.test(c))
    const isMangaPublisher = MANGA_PUBLISHERS.some(p => publisher.includes(p))
    let detectedTypeId = novelId
    if ((isMangaCategory || isMangaPublisher) && mangaId) detectedTypeId = mangaId
    else if (isComicCategory && comicId) detectedTypeId = comicId

    // Extract "Vol. N" from title into subtitle when subtitle is absent
    let title = result.title || ''
    let subtitle = result.subtitle || ''
    if (!subtitle && title) {
      const volMatch = title.match(/,?\s*(Vol(?:ume)?\.?\s*\d+(?:\.\d+)?)$/i)
      if (volMatch) {
        subtitle = volMatch[1].trim()
        title = title.slice(0, title.length - volMatch[0].length).trim()
      }
    }

    // Fill book-level fields (no ISBN/publisher/date on book any more)
    setForm(f => ({
      ...f,
      title: title || f.title,
      subtitle: subtitle || f.subtitle,
      description: result.description || f.description,
      media_type_id: detectedTypeId ?? f.media_type_id,
    }))

    // Fill edition-level fields (ISBN, publisher, date, language live here)
    setEdition(e => ({
      ...e,
      language:     result.language     || e.language,
      publisher:    result.publisher    || e.publisher,
      publish_date: result.publish_date || e.publish_date,
      isbn_10:      result.isbn_10      || e.isbn_10,
      isbn_13:      result.isbn_13      || e.isbn_13,
      page_count:   result.page_count != null ? String(result.page_count) : e.page_count,
    }))
    setShowEdition(true)

    // Auto-populate contributors (search for existing, create if missing)
    if (result.authors && result.authors.length > 0) {
      const imported: BookFormContributor[] = []
      for (const rawName of result.authors) {
        // Strip "(Role)" suffix if it matches a known contributor role.
        // e.g. "Giancarlo Carracuzzo (Illustrator)" → name="Giancarlo Carracuzzo", role="illustrator"
        let name = rawName
        let role = 'author'
        const parenMatch = rawName.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
        if (parenMatch) {
          const candidate = parenMatch[2].toLowerCase()
          if (CONTRIBUTOR_ROLES.includes(candidate)) {
            name = parenMatch[1].trim()
            role = candidate
          }
        }
        try {
          const matches = await callApi<ContributorResult[]>(
            `/api/v1/contributors?q=${encodeURIComponent(name)}`
          )
          const exact = (matches ?? []).find(
            c => c.name.toLowerCase() === name.toLowerCase()
          )
          if (exact) {
            imported.push({ contributor: exact, role })
          } else {
            const created = await callApi<ContributorResult>('/api/v1/contributors', {
              method: 'POST',
              body: JSON.stringify({ name }),
            })
            if (created) imported.push({ contributor: created, role })
          }
        } catch { /* skip this contributor on error */ }
      }
      if (imported.length > 0) {
        // Deduplicate by (contributor.id, role) in case the provider returned
        // the same author name more than once.
        const seen = new Set<string>()
        setContributors(imported.filter(c => {
          const key = `${c.contributor!.id}:${c.role}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        }))
      }
    }

    if (result.cover_url) setPendingCoverUrl(result.cover_url)

    // Match provider categories against instance genres
    const resultCategories = result.categories ?? []
    if (resultCategories.length > 0 && allGenres.length > 0) {
      const matched = allGenres.filter(g =>
        resultCategories.some(c => c.toLowerCase() === g.name.toLowerCase())
      )
      if (matched.length > 0) setSelectedGenres(matched)
    }

    setMode('manual')
  }

  // When ISBN is entered, suggest physical edition automatically
  const isbnEntered = edition.isbn_10 || edition.isbn_13

  const createTag = async (name: string) => {
    if (!name.trim() || isCreatingTag) return
    setIsCreatingTag(true)
    try {
      const tag = await callApi<Tag>(`/api/v1/libraries/${libraryId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), color: newTagColor }),
      })
      if (tag) {
        setLibraryTags(ts => [...ts, tag])
        setSelectedTags(ts => [...ts, tag])
      }
      setTagQuery('')
      setTagDropdownOpen(false)
    } catch { /* ignore */ }
    finally { setIsCreatingTag(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setIsLoading(true)
    try {
      const body: Record<string, unknown> = {
        ...form,
        contributors: contributors
          .filter(c => c.contributor !== null)
          .map((c, i) => ({ contributor_id: c.contributor!.id, role: c.role, display_order: i }))
          // Deduplicate by (contributor_id, role) — providers can return the same
          // author name twice, which resolves to the same contributor ID.
          .filter((c, idx, arr) =>
            arr.findIndex(x => x.contributor_id === c.contributor_id && x.role === c.role) === idx
          ),
        tag_ids: selectedTags.map(t => t.id),
        genre_ids: selectedGenres.map(g => g.id),
      }
      if (showEdition) {
        const isAudio = edition.format === 'audiobook'
        const isPhysical = !isAudio && edition.format !== 'ebook' && edition.format !== 'digital'
        const durationSecs = isAudio
          ? ((Number(edition.duration_hours) || 0) * 3600) + ((Number(edition.duration_minutes) || 0) * 60)
          : null
        body.edition = {
          format:           edition.format,
          edition_name:     edition.edition_name,
          language:         edition.language,
          publisher:        edition.publisher,
          publish_date:     edition.publish_date,
          isbn_10:          isPhysical ? edition.isbn_10 : null,
          isbn_13:          !isAudio ? edition.isbn_13 : null,
          page_count:       !isAudio && edition.page_count ? Number(edition.page_count) : null,
          duration_seconds: durationSecs || null,
          narrator:         isAudio ? edition.narrator : null,
          is_primary:       edition.is_primary,
        }
      }
      const book = await callApi<Book>(`/api/v1/libraries/${libraryId}/books`, {
        method: 'POST',
        body: JSON.stringify(body),
      })

      // Fetch cover from provider result (best-effort)
      const bookId = book!.id
      if (pendingCoverUrl) {
        callApi(`/api/v1/libraries/${libraryId}/books/${bookId}/cover/fetch`, {
          method: 'POST',
          body: JSON.stringify({ url: pendingCoverUrl }),
        }).catch(() => {})
      }

      // Apply shelf membership
      for (const id of selectedShelfIds)
        await callApi(`/api/v1/libraries/${libraryId}/shelves/${id}/books`, { method: 'POST', body: JSON.stringify({ book_id: bookId }) }).catch(() => {})

      onSaved(book)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save book')
    } finally { setIsLoading(false) }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const labelCls = 'block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5'

  const filteredTags = libraryTags.filter(t =>
    !selectedTags.some(s => s.id === t.id) &&
    t.name.toLowerCase().includes(tagQuery.toLowerCase())
  )
  const filteredGenres = allGenres.filter(g =>
    !selectedGenres.some(s => s.id === g.id) &&
    g.name.toLowerCase().includes(genreQuery.toLowerCase())
  )
  const tagQueryMatchesExisting = libraryTags.some(t => t.name.toLowerCase() === tagQuery.trim().toLowerCase())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Add book</h2>
            <button type="button" onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Close">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-3 flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
            <button type="button" onClick={() => setMode('isbn')}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === 'isbn' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              By ISBN
            </button>
            <button type="button" onClick={() => setMode('search')}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === 'search' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              By Title
            </button>
            <button type="button" onClick={() => setMode('manual')}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === 'manual' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              Manual
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {mode === 'isbn' ? (
            <div className="space-y-4">
              {scanning ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">Point your camera at a barcode…</p>
                  <video ref={videoRef} className="w-full rounded-lg bg-black aspect-video object-cover" playsInline />
                  <button type="button" onClick={stopScan}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    Cancel scan
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input type="text" value={isbnInput}
                      ref={isbnInputRef}
                      onChange={e => setIsbnInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && doISBNLookup(isbnInput)}
                      placeholder="Enter ISBN-10 or ISBN-13…"
                      className={inputCls} />
                    <button type="button" onClick={() => doISBNLookup(isbnInput)} disabled={isbnLoading || !isbnInput.trim()}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      {isbnLoading ? '…' : 'Search'}
                    </button>
                    <button type="button" onClick={startScan}
                      className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      title="Scan barcode">📷</button>
                  </div>
                  {isbnError && <p className="text-sm text-red-600 dark:text-red-400">{isbnError}</p>}
                  {isbnLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Searching providers…</p>}
                  {isbnDuplicate && (
                    <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm">
                      <p className="font-medium text-amber-800 dark:text-amber-300">Already in your library</p>
                      <p className="mt-0.5 text-amber-700 dark:text-amber-400 truncate">{isbnDuplicate.title}</p>
                      <div className="mt-2 flex gap-3">
                        <Link to={`/libraries/${libraryId}/books/${isbnDuplicate.id}`}
                          className="text-amber-800 dark:text-amber-300 font-medium underline hover:no-underline" onClick={onClose}>
                          View existing →
                        </Link>
                        <span className="text-amber-600 dark:text-amber-500">or import to add an edition</span>
                      </div>
                    </div>
                  )}
                  {isbnResults.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        {isbnResults.length} result{isbnResults.length !== 1 ? 's' : ''}
                      </p>
                      {[...isbnResults].sort((a, b) => countISBNFields(b) - countISBNFields(a)).map((r, i) => {
                        const fieldCount = countISBNFields(r)
                        return (
                          <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
                            <div className="flex gap-4">
                              {r.cover_url && (
                                <img src={r.cover_url} alt="" referrerPolicy="no-referrer" className="w-14 h-20 object-cover rounded-lg flex-shrink-0 bg-gray-200 dark:bg-gray-700 shadow-sm" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-900 dark:text-white">{r.title}</p>
                                {r.subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{r.subtitle}</p>}
                                {r.authors?.length > 0 && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{r.authors.join(', ')}</p>}
                                <div className="flex items-center gap-2 mt-2">
                                  <span className="text-xs text-gray-400 dark:text-gray-500">via {r.provider_display}</span>
                                  <span className="text-gray-300 dark:text-gray-600">·</span>
                                  <span className={`text-xs font-medium ${fieldCount >= 8 ? 'text-green-600 dark:text-green-400' : fieldCount >= 5 ? 'text-amber-500' : 'text-gray-400'}`}>
                                    {fieldCount}/{TOTAL_ISBN_FIELDS} fields
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button type="button" onClick={() => importResult(r)}
                              className="mt-3 w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                              Import this result
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <button type="button" onClick={() => setMode('manual')}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                    Add manually instead →
                  </button>
                </>
              )}
            </div>
          ) : mode === 'search' ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input type="text" value={searchInput}
                  ref={searchInputRef}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doBookSearch(searchInput)}
                  placeholder="Search by title, author, or keyword…"
                  className={inputCls} />
                <button type="button" onClick={() => doBookSearch(searchInput)} disabled={searchLoading || !searchInput.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {searchLoading ? '…' : 'Search'}
                </button>
              </div>
              {searchError && <p className="text-sm text-red-600 dark:text-red-400">{searchError}</p>}
              {searchLoading && (
                <div>
                  <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{
                        width: `${searchProgress}%`,
                        transition: searchProgress > 0 ? 'width 0.4s ease-out' : 'none',
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">Searching providers…</p>
                </div>
              )}
              {searchResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                  </p>
                  {searchResults.map((r, i) => (
                    <button key={i} type="button"
                      onClick={async () => { await importResult(r); setMode('manual') }}
                      className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                      <div className="flex gap-3">
                        {r.cover_url ? (
                          <img src={r.cover_url} alt="" referrerPolicy="no-referrer" className="w-10 h-14 object-cover rounded flex-shrink-0 bg-gray-200 dark:bg-gray-700" />
                        ) : (
                          <div className="w-10 h-14 rounded flex-shrink-0 bg-gray-200 dark:bg-gray-700" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{r.title}</p>
                          {r.subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.subtitle}</p>}
                          {r.authors?.length > 0 && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 truncate">{r.authors.join(', ')}</p>}
                          <div className="flex items-center gap-2 mt-1">
                            {r.publish_date && <span className="text-xs text-gray-400 dark:text-gray-500">{r.publish_date.slice(0, 4)}</span>}
                            {r.publish_date && <span className="text-gray-300 dark:text-gray-600">·</span>}
                            <span className="text-xs text-gray-400 dark:text-gray-500">{r.provider_display}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => setMode('manual')}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Add manually instead →
              </button>
            </div>
          ) : (
          <form id="book-form" onSubmit={handleSubmit} className="space-y-5">

            {/* Title + Subtitle */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Title <span className="text-red-500 normal-case tracking-normal font-normal">*</span></label>
                <input type="text" value={form.title} ref={titleInputRef} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Attack on Titan" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Subtitle</label>
                <input type="text" value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))}
                  placeholder="e.g. Vol. 15" className={inputCls} />
              </div>
            </div>

            {/* Media type */}
            <div>
              <label className={labelCls}>Media type <span className="text-red-500 normal-case tracking-normal font-normal">*</span></label>
              <MediaTypeSelect
                value={form.media_type_id}
                mediaTypes={mediaTypes}
                onChange={id => setForm(f => ({ ...f, media_type_id: id }))}
              />
            </div>

            {/* Description */}
            <div>
              <label className={labelCls}>Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={4} className={`${inputCls} resize-none`} />
            </div>

            {/* Contributors */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls}>Contributors</label>
                <button type="button"
                  onClick={() => setContributors(cs => [...cs, { contributor: null, role: 'author' }])}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ Add</button>
              </div>
              <div className="space-y-2">
                {contributors.map((c, i) => (
                  <ContributorRow key={i}
                    contributor={c.contributor} role={c.role}
                    onContributorChange={contributor => setContributors(cs => cs.map((x, j) => j === i ? { ...x, contributor } : x))}
                    onRoleChange={role => setContributors(cs => cs.map((x, j) => j === i ? { ...x, role } : x))}
                    onRemove={() => setContributors(cs => cs.filter((_, j) => j !== i))} />
                ))}
                {contributors.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">No contributors added.</p>
                )}
              </div>
            </div>

            {/* Tags + Genres — 2 columns */}
            <div className="grid grid-cols-2 gap-4">

              {/* Tags */}
              <div>
                <label className={labelCls}>Tags</label>
                <div className="relative">
                  {/* Selected chips */}
                  {selectedTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {selectedTags.map(tag => (
                        <span key={tag.id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                          style={{ backgroundColor: tag.color || '#6b7280' }}>
                          {tag.name}
                          <button type="button" onClick={() => setSelectedTags(ts => ts.filter(t => t.id !== tag.id))}
                            className="opacity-70 hover:opacity-100 leading-none">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={tagQuery}
                    onChange={e => { setTagQuery(e.target.value); setTagDropdownOpen(true) }}
                    onFocus={() => setTagDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setTagDropdownOpen(false), 150)}
                    placeholder="Search or create tags…"
                    className={inputCls}
                  />
                  {tagDropdownOpen && (tagQuery || filteredTags.length > 0) && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg max-h-48 overflow-y-auto">
                      {filteredTags.map(tag => (
                        <button key={tag.id} type="button"
                          onMouseDown={e => { e.preventDefault(); setSelectedTags(ts => [...ts, tag]); setTagQuery(''); tagInputRef.current?.focus() }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color || '#6b7280' }} />
                          <span className="text-gray-800 dark:text-gray-200">{tag.name}</span>
                        </button>
                      ))}
                      {tagQuery.trim() && !tagQueryMatchesExisting && (
                        <button type="button"
                          onMouseDown={e => { e.preventDefault(); createTag(tagQuery.trim()) }}
                          disabled={isCreatingTag}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                          <span className="flex-shrink-0">+</span>
                          <span>Create "{tagQuery.trim()}"</span>
                          <div className="ml-auto">
                            <select value={newTagColor} onChange={e => { e.stopPropagation(); setNewTagColor(e.target.value) }}
                              onMouseDown={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                              className="text-xs border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                              {TAG_COLORS.filter(c => c.value).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                          </div>
                        </button>
                      )}
                      {filteredTags.length === 0 && !tagQuery.trim() && (
                        <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">No more tags available</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Genres */}
              <div>
                <label className={labelCls}>Genres</label>
                <div className="relative">
                  {selectedGenres.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {selectedGenres.map(g => (
                        <span key={g.id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                          {g.name}
                          <button type="button" onClick={() => setSelectedGenres(gs => gs.filter(x => x.id !== g.id))}
                            className="opacity-70 hover:opacity-100 leading-none">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input
                    ref={genreInputRef}
                    type="text"
                    value={genreQuery}
                    onChange={e => { setGenreQuery(e.target.value); setGenreDropdownOpen(true) }}
                    onFocus={() => setGenreDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setGenreDropdownOpen(false), 150)}
                    placeholder="Search genres…"
                    className={inputCls}
                  />
                  {genreDropdownOpen && filteredGenres.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg max-h-48 overflow-y-auto">
                      {filteredGenres.map(g => (
                        <button key={g.id} type="button"
                          onMouseDown={e => { e.preventDefault(); setSelectedGenres(gs => [...gs, g]); setGenreQuery(''); genreInputRef.current?.focus() }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                          {g.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {genreDropdownOpen && filteredGenres.length === 0 && genreQuery && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg px-3 py-2">
                      <p className="text-xs text-gray-400 dark:text-gray-500">No matching genres</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Shelves */}
            {allShelves.length > 0 && (
              <div>
                <label className={labelCls}>Shelves</label>
                <div className="flex flex-wrap gap-2">
                  {allShelves.map(shelf => {
                    const checked = selectedShelfIds.has(shelf.id)
                    return (
                      <label key={shelf.id}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                          checked ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}>
                        <input type="checkbox" className="sr-only" checked={checked}
                          onChange={e => setSelectedShelfIds(ids => {
                            const next = new Set(ids)
                            if (e.target.checked) next.add(shelf.id)
                            else next.delete(shelf.id)
                            return next
                          })} />
                        {shelf.icon && <span>{shelf.icon}</span>}
                        {shelf.name}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Edition details */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button type="button"
                  onClick={() => setShowEdition(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                  <span className="flex items-center gap-2">
                    <svg className={`w-3.5 h-3.5 transition-transform ${showEdition ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M7.293 4.293a1 1 0 011.414 0L14 9.586l-5.293 5.293a1 1 0 01-1.414-1.414L11.586 9.586 6.293 4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    <span>Edition details</span>
                    {!showEdition && <span className="text-xs font-normal text-gray-400 dark:text-gray-500">— no edition will be created</span>}
                  </span>
                  {isbnEntered && !showEdition && (
                    <span className="text-xs text-blue-600 dark:text-blue-400">ISBN entered</span>
                  )}
                </button>
                {showEdition && (() => {
                  const isAudio = edition.format === 'audiobook'
                  const isEbook = edition.format === 'ebook' || edition.format === 'digital'
                  const isPhysical = !isAudio && !isEbook
                  return (
                  <div className="px-4 pb-4 pt-3 space-y-3 border-t border-gray-100 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-800/30">
                    {/* Format buttons */}
                    <div className="grid grid-cols-4 gap-2">
                      {([
                        { value: 'paperback', label: 'Paperback', icon: (
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        )},
                        { value: 'hardcover', label: 'Hardcover', icon: (
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 4.5A2.25 2.25 0 018.25 2.25h10.5A1.5 1.5 0 0120.25 3.75v16.5a1.5 1.5 0 01-1.5 1.5H8.25A2.25 2.25 0 016 19.5v-15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 4.5h1.5m-1.5 15h1.5" />
                            <line strokeLinecap="round" x1="7.5" y1="2.25" x2="7.5" y2="21.75" />
                          </svg>
                        )},
                        { value: 'ebook', label: 'E-Book', icon: (
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5h3m-6.75 2.25h10.5a2.25 2.25 0 002.25-2.25v-15a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 4.5v15a2.25 2.25 0 002.25 2.25z" />
                          </svg>
                        )},
                        { value: 'audiobook', label: 'Audiobook', icon: (
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a9 9 0 00-9 9v1.5A1.5 1.5 0 004.5 15H6a1.5 1.5 0 001.5-1.5v-3A1.5 1.5 0 006 9h-.35A7.5 7.5 0 0112 4.5a7.5 7.5 0 016.35 4.5H18a1.5 1.5 0 00-1.5 1.5v3A1.5 1.5 0 0018 15h1.5A1.5 1.5 0 0021 13.5V12a9 9 0 00-9-9z" />
                          </svg>
                        )},
                      ] as { value: string; label: string; icon: React.ReactNode }[]).map(fmt => (
                        <button key={fmt.value} type="button"
                          onClick={() => setEdition(d => ({ ...d, format: fmt.value }))}
                          className={`flex flex-col items-center gap-1.5 rounded-xl border-2 py-3 text-xs font-medium transition-colors ${
                            edition.format === fmt.value
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                              : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/40'
                          }`}>
                          {fmt.icon}
                          {fmt.label}
                        </button>
                      ))}
                    </div>

                    {/* Edition name */}
                    <div>
                      <label className={labelCls}>Edition name</label>
                      <input type="text" value={edition.edition_name} onChange={e => setEdition(d => ({ ...d, edition_name: e.target.value }))}
                        placeholder="e.g. 1st Edition" className={inputCls} />
                    </div>

                    {/* Row 2: publisher + publish date */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Publisher</label>
                        <input type="text" value={edition.publisher} onChange={e => setEdition(d => ({ ...d, publisher: e.target.value }))} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Publish date</label>
                        <input type="date" value={edition.publish_date} onChange={e => setEdition(d => ({ ...d, publish_date: e.target.value }))} className={inputCls} />
                      </div>
                    </div>

                    {/* Row 3: language (all formats) */}
                    <div>
                      <label className={labelCls}>Language</label>
                      <select value={edition.language} onChange={e => setEdition(d => ({ ...d, language: e.target.value }))} className={inputCls}>
                        <option value="">— select —</option>
                        {LANGUAGE_OPTIONS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </select>
                    </div>

                    {/* ISBNs: physical gets both, ebook gets ISBN-13 only, audiobook gets neither */}
                    {isPhysical && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelCls}>ISBN-13</label>
                          <input type="text" value={edition.isbn_13} onChange={e => setEdition(d => ({ ...d, isbn_13: e.target.value }))}
                            placeholder="978-…" className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>ISBN-10</label>
                          <input type="text" value={edition.isbn_10} onChange={e => setEdition(d => ({ ...d, isbn_10: e.target.value }))} className={inputCls} />
                        </div>
                      </div>
                    )}
                    {isEbook && (
                      <div>
                        <label className={labelCls}>ISBN-13</label>
                        <input type="text" value={edition.isbn_13} onChange={e => setEdition(d => ({ ...d, isbn_13: e.target.value }))}
                          placeholder="978-…" className={inputCls} />
                      </div>
                    )}

                    {/* Page count: physical + ebook */}
                    {!isAudio && (
                      <div>
                        <label className={labelCls}>Page count</label>
                        <input type="number" min="1" value={edition.page_count} onChange={e => setEdition(d => ({ ...d, page_count: e.target.value }))} className={inputCls} />
                      </div>
                    )}

                    {/* Duration + narrator: audiobook only */}
                    {isAudio && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={labelCls}>Duration — hours</label>
                            <input type="number" min="0" value={edition.duration_hours}
                              onChange={e => setEdition(d => ({ ...d, duration_hours: e.target.value }))}
                              placeholder="0" className={inputCls} />
                          </div>
                          <div>
                            <label className={labelCls}>Duration — minutes</label>
                            <input type="number" min="0" max="59" value={edition.duration_minutes}
                              onChange={e => setEdition(d => ({ ...d, duration_minutes: e.target.value }))}
                              placeholder="0" className={inputCls} />
                          </div>
                        </div>
                        <div>
                          <label className={labelCls}>Narrator</label>
                          <input type="text" value={edition.narrator} onChange={e => setEdition(d => ({ ...d, narrator: e.target.value }))} className={inputCls} />
                        </div>
                      </div>
                    )}

                    {/* Date acquired moved to per-library tracking under M2M — follow-up. */}
                  </div>
                  )
                })()}
              </div>

            {error && <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">{error}</div>}
          </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 flex-shrink-0">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-5 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancel
          </button>
          {mode === 'manual' && (
            <button type="submit" form="book-form" disabled={isLoading || !form.title || !form.media_type_id}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {isLoading ? 'Saving…' : 'Add book'}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── Add/Edit Edition modal ───────────────────────────────────────────────────

export { AddEditionModal, LANGUAGE_OPTIONS } from '../../components/AddEditionModal'

const TAG_COLORS = [
  { value: '', label: 'Default' },
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#6b7280', label: 'Grey' },
]

const SHELF_COLORS = TAG_COLORS
// ─── Shelves ──────────────────────────────────────────────────────────────────

interface ShelfFormModalProps {
  libraryId: string
  shelf?: Shelf | null
  onClose: () => void
  onSaved: () => void
}

function ShelfFormModal({ libraryId, shelf, onClose, onSaved }: ShelfFormModalProps) {
  const { callApi } = useAuth()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
  const [form, setForm] = useState({
    name: shelf?.name ?? '',
    description: shelf?.description ?? '',
    color: shelf?.color ?? '',
    icon: shelf?.icon ?? '',
    display_order: shelf?.display_order ?? 0,
  })
  const [libraryTags, setLibraryTags] = useState<Tag[]>([])
  const [selectedTags, setSelectedTags] = useState<Tag[]>(shelf?.tags ?? [])
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#6b7280')
  const [showNewTag, setShowNewTag] = useState(false)
  const [isCreatingTag, setIsCreatingTag] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    callApi<Tag[]>(`/api/v1/libraries/${libraryId}/tags`).then(ts => setLibraryTags(ts ?? [])).catch(() => {})
  }, [callApi, libraryId])

  const createTag = async () => {
    if (!newTagName.trim()) return
    setIsCreatingTag(true)
    try {
      const tag = await callApi<Tag>(`/api/v1/libraries/${libraryId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      })
      if (tag) { setLibraryTags(ts => [...ts, tag]); setSelectedTags(ts => [...ts, tag]) }
      setNewTagName(''); setShowNewTag(false)
    } catch { /* ignore */ }
    finally { setIsCreatingTag(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setIsLoading(true)
    try {
      const url = shelf
        ? `/api/v1/libraries/${libraryId}/shelves/${shelf.id}`
        : `/api/v1/libraries/${libraryId}/shelves`
      await callApi(url, { method: shelf ? 'PUT' : 'POST', body: JSON.stringify({ ...form, tag_ids: selectedTags.map(t => t.id) }) })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save shelf')
    } finally { setIsLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-900 shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{shelf ? 'Edit shelf' : 'New shelf'}</h3>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
            <input type="text" autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Favourites"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Color</label>
              <select value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                {SHELF_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Icon</label>
              <EmojiPicker value={form.icon} onChange={emoji => setForm(f => ({ ...f, icon: emoji }))} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tags</label>
              <button type="button" onClick={() => setShowNewTag(v => !v)}
                className="text-xs text-blue-600 hover:underline">+ New tag</button>
            </div>
            <div className="flex flex-wrap gap-1.5 min-h-[28px]">
              {libraryTags.map(tag => {
                const selected = selectedTags.some(t => t.id === tag.id)
                return (
                  <button key={tag.id} type="button"
                    onClick={() => setSelectedTags(ts => selected ? ts.filter(t => t.id !== tag.id) : [...ts, tag])}
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-all ${
                      selected ? 'ring-transparent text-white' : 'bg-white dark:bg-gray-800 ring-gray-300 dark:ring-gray-600 text-gray-600 dark:text-gray-300 hover:ring-gray-400'
                    }`}
                    style={selected ? { backgroundColor: tag.color || '#6b7280' } : tag.color ? { color: tag.color } : undefined}>
                    {tag.name}
                  </button>
                )
              })}
              {libraryTags.length === 0 && !showNewTag && (
                <p className="text-xs text-gray-400 dark:text-gray-500">No tags in this library yet.</p>
              )}
            </div>
            {showNewTag && (
              <div className="mt-2 flex items-center gap-2">
                <input type="text" value={newTagName} onChange={e => setNewTagName(e.target.value)}
                  placeholder="Tag name"
                  className="flex-1 h-8 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-2 text-xs focus:border-blue-500 focus:outline-none" />
                <select value={newTagColor} onChange={e => setNewTagColor(e.target.value)}
                  className="h-8 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-2 text-xs focus:border-blue-500 focus:outline-none">
                  {TAG_COLORS.filter(c => c.value).map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <button type="button" disabled={isCreatingTag || !newTagName.trim()}
                  onClick={createTag}
                  className="h-8 px-3 rounded bg-blue-600 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">Add</button>
                <button type="button" onClick={() => setShowNewTag(false)}
                  className="h-8 px-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
              </div>
            )}
          </div>
          {error && <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-400">{error}</div>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Cancel</button>
            <button type="submit" disabled={isLoading || !form.name.trim()}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {isLoading ? 'Saving…' : shelf ? 'Save changes' : 'Create shelf'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface AddBookToShelfModalProps {
  libraryId: string
  shelfId: string
  existingBookIds: string[]
  onClose: () => void
  onAdded: () => void
}

function AddBookToShelfModal({ libraryId, shelfId, existingBookIds, onClose, onAdded }: AddBookToShelfModalProps) {
  const { callApi } = useAuth()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Book[]>([])
  const [isSearching, setIsSearching] = useState(false)

  useEffect(() => {
    if (!search) { setResults([]); return }
    setIsSearching(true)
    callApi<PagedBooks>(`/api/v1/libraries/${libraryId}/books?q=${encodeURIComponent(search)}&per_page=20`)
      .then(data => setResults((data?.items ?? []).filter(b => !existingBookIds.includes(b.id))))
      .catch(() => {})
      .finally(() => setIsSearching(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const addBook = async (bookId: string) => {
    await callApi(`/api/v1/libraries/${libraryId}/shelves/${shelfId}/books`, {
      method: 'POST',
      body: JSON.stringify({ book_id: bookId }),
    }).catch(() => {})
    onAdded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Add book to shelf</h3>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={e => { e.preventDefault(); setSearch(query) }} className="flex gap-2 mb-4">
          <input type="text" autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search books…"
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <button type="submit"
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Search</button>
        </form>
        {isSearching && <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Searching…</p>}
        {!isSearching && search && results.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No books found.</p>
        )}
        {results.length > 0 && (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 max-h-64 overflow-y-auto">
            {results.map(book => (
              <li key={book.id} className="flex items-center justify-between py-2.5 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{book.title}</p>
                  {book.contributors.length > 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{book.contributors.map(c => c.name).join(', ')}</p>
                  )}
                </div>
                <button onClick={() => addBook(book.id)}
                  className="flex-shrink-0 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors">
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}

interface ShelfDetailViewProps {
  shelf: Shelf
  libraryId: string
  onBack: () => void
}

function ShelfDetailView({ shelf, libraryId, onBack }: ShelfDetailViewProps) {
  const { callApi } = useAuth()
  const [books, setBooks] = useState<Book[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddBook, setShowAddBook] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const list = await callApi<Book[]>(`/api/v1/libraries/${libraryId}/shelves/${shelf.id}/books`)
      setBooks(list ?? [])
    } catch { /* ignore */ }
    finally { setIsLoading(false) }
  }, [callApi, libraryId, shelf.id])

  useEffect(() => { load() }, [load])

  const removeBook = async (bookId: string) => {
    if (!confirm('Remove this book from the shelf?')) return
    await callApi(`/api/v1/libraries/${libraryId}/shelves/${shelf.id}/books/${bookId}`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">← Back</button>
        <div className="flex-1" />
        <ExportButton
          urlFor={format => booksExportUrl(libraryId, format, { shelfId: shelf.id })}
          fallbackName={`shelf-${shelf.name}`}
          label="Export shelf"
          disabled={books.length === 0}
        />
        <button onClick={() => setShowAddBook(true)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
          Add book
        </button>
      </div>

      {shelf.description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{shelf.description}</p>}

      {isLoading && <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-16">Loading…</div>}

      {!isLoading && books.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No books on this shelf</p>
          <button onClick={() => setShowAddBook(true)} className="text-sm text-blue-600 hover:underline">Add the first book</button>
        </div>
      )}

      {!isLoading && books.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                {['Title', 'Type', 'Tags', 'Contributors', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {books.map(book => (
                <tr key={book.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-white">{book.title}</p>
                    {book.subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-xs">{book.subtitle}</p>}
                    {book.genres?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {book.genres.map(genre => (
                          <span key={genre.id}
                            className="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                            {genre.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {book.media_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {book.tags.map(tag => (
                        <span key={tag.id}
                          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium text-white"
                          style={{ backgroundColor: tag.color || '#6b7280' }}>
                          {tag.name}
                        </span>
                      ))}
                      {!book.tags.length && <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
                    {book.contributors.length > 0
                      ? book.contributors.map(c => c.name).join(', ')
                      : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => removeBook(book.id)}
                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 transition-colors">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddBook && (
        <AddBookToShelfModal
          libraryId={libraryId}
          shelfId={shelf.id}
          existingBookIds={books.map(b => b.id)}
          onClose={() => setShowAddBook(false)}
          onAdded={() => { setShowAddBook(false); load() }}
        />
      )}
    </div>
  )
}

interface ShelvesTabProps {
  libraryId: string
  setExtraCrumbs: (crumbs: Crumb[]) => void
}

function ShelvesTab({ libraryId, setExtraCrumbs }: ShelvesTabProps) {
  const { callApi } = useAuth()
  const [shelves, setShelves] = useState<Shelf[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editShelf, setEditShelf] = useState<Shelf | null>(null)
  const [viewShelf, setViewShelf] = useState<Shelf | null>(null)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [allTags, setAllTags] = useState<Tag[]>([])

  useEffect(() => {
    setExtraCrumbs(viewShelf
      ? [{ label: 'Shelves', to: `/libraries/${libraryId}/shelves` }, { label: viewShelf.name }]
      : [{ label: 'Shelves' }]
    )
  }, [viewShelf, setExtraCrumbs])

  useEffect(() => {
    callApi<Tag[]>(`/api/v1/libraries/${libraryId}/tags`).then(ts => setAllTags(ts ?? [])).catch(() => {})
  }, [callApi, libraryId])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (tagFilter) params.set('tag', tagFilter)
      const list = await callApi<Shelf[]>(`/api/v1/libraries/${libraryId}/shelves?${params}`)
      setShelves(list ?? [])
    } catch { /* ignore */ }
    finally { setIsLoading(false) }
  }, [callApi, libraryId, search, tagFilter])

  useEffect(() => { load() }, [load])

  const deleteShelf = async (shelf: Shelf) => {
    if (!confirm(`Delete shelf "${shelf.name}"?`)) return
    await callApi(`/api/v1/libraries/${libraryId}/shelves/${shelf.id}`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  if (viewShelf) {
    return (
      <ShelfDetailView
        shelf={viewShelf}
        libraryId={libraryId}
        onBack={() => { setViewShelf(null); load() }}
      />
    )
  }

  return (
    <div>
      {/* Search bar + tag filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1 relative">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search shelves…"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap">
          New shelf
        </button>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setTagFilter('')}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-all ${!tagFilter ? 'bg-gray-700 text-white ring-transparent' : 'bg-white dark:bg-gray-800 ring-gray-300 dark:ring-gray-600 text-gray-600 dark:text-gray-300 hover:ring-gray-400'}`}>
            All
          </button>
          {allTags.map(tag => (
            <button key={tag.id}
              onClick={() => setTagFilter(tagFilter === tag.name ? '' : tag.name)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-all ${tagFilter === tag.name ? 'ring-transparent text-white' : 'bg-white dark:bg-gray-800 ring-gray-300 dark:ring-gray-600 text-gray-600 dark:text-gray-300 hover:ring-gray-400'}`}
              style={tagFilter === tag.name ? { backgroundColor: tag.color || '#6b7280' } : tag.color ? { color: tag.color } : undefined}>
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {isLoading && <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-16">Loading…</div>}

      {!isLoading && shelves.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-12 text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
            {search || tagFilter ? 'No shelves match your search.' : 'No shelves yet'}
          </p>
          {!search && !tagFilter && (
            <button onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
              Create your first shelf
            </button>
          )}
        </div>
      )}

      {!isLoading && shelves.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                {['Name', 'Tags', 'Books', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {shelves.map(shelf => (
                <tr key={shelf.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <td className="px-4 py-3">
                    <button onClick={() => setViewShelf(shelf)} className="text-left group flex items-center gap-2">
                      {shelf.icon
                        ? <span className="text-base flex-shrink-0">{shelf.icon}</span>
                        : shelf.color
                          ? <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: shelf.color }} />
                          : null}
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors">{shelf.name}</p>
                        {shelf.description && <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-xs">{shelf.description}</p>}
                      </div>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {shelf.tags && shelf.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {shelf.tags.map(tag => (
                          <span key={tag.id}
                            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: tag.color || '#6b7280' }}>
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                    {shelf.book_count} book{shelf.book_count !== 1 ? 's' : ''}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => setEditShelf(shelf)}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 transition-colors">Edit</button>
                      <button onClick={() => deleteShelf(shelf)}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 transition-colors">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showCreate || editShelf) && (
        <ShelfFormModal
          libraryId={libraryId}
          shelf={editShelf}
          onClose={() => { setShowCreate(false); setEditShelf(null) }}
          onSaved={() => { setShowCreate(false); setEditShelf(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Books tab ────────────────────────────────────────────────────────────────

interface BooksTabProps {
  libraryId: string
  mediaTypes: MediaType[]
  canEdit: boolean
}

function BooksTab({ libraryId, mediaTypes, canEdit }: BooksTabProps) {
  const { callApi } = useAuth()
  const { show: showToast } = useToast()
  const location = useLocation()
  const [data, setData] = useState<PagedBooks | null>(null)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(() => {
    const s = location.state as { isbn?: string; openAdd?: boolean } | null
    return !!(s?.isbn || s?.openAdd)
  })
  const [addInitialIsbn] = useState(() => (location.state as { isbn?: string } | null)?.isbn ?? '')
  const [addInitialTitle] = useState(() => (location.state as { title?: string } | null)?.title ?? '')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkApplying, setIsBulkApplying] = useState(false)
  const [editBook, setEditBook] = useState<Book | null>(null)
  const [seriesSuggestion, setSeriesSuggestion] = useState<{ book: Book; series: Series; position: number | null } | null>(null)

  const ALL_COLS = ['type', 'tags', 'contributors', 'series', 'shelves', 'date_added', 'publisher', 'published', 'language'] as const
  type ColKey = typeof ALL_COLS[number]
  const COL_LABELS: Record<ColKey, string> = {
    type: 'Type', tags: 'Tags', contributors: 'Contributors',
    series: 'Series', shelves: 'Shelves', date_added: 'Date Added',
    publisher: 'Publisher', published: 'Published', language: 'Language',
  }
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    try {
      const saved = localStorage.getItem('library-books-cols-v2')
      if (saved) return new Set(JSON.parse(saved) as ColKey[])
    } catch { /* ignore */ }
    return new Set<ColKey>(['type', 'tags', 'contributors', 'series'])
  })
  const [colPickerOpen, setColPickerOpen] = useState(false)
  const colPickerRef = useRef<HTMLDivElement>(null)
  // Set to true once the initial API preferences load has settled, so subsequent
  // user-initiated changes are synced back without causing a save loop.
  const prefsReadyRef = useRef(false)

  useEffect(() => {
    localStorage.setItem('library-books-cols-v2', JSON.stringify([...visibleCols]))
  }, [visibleCols])

  // Declared above the preferences effect below, which calls all three
  // setters. They seed from localStorage so the UI has something before the
  // server round-trip lands.
  const [perPage, setPerPage] = useState(() => {
    const saved = localStorage.getItem('librarium:books:perPage')
    const n = saved ? Number(saved) : 25
    return [25, 50, 100, 200].includes(n) ? n : 25
  })
  const [viewMode, setViewMode] = useState<'table' | 'grid'>(() =>
    localStorage.getItem('librarium:books:viewMode') === 'grid' ? 'grid' : 'table'
  )
  const [showReadBadges, setShowReadBadges] = useState(() =>
    localStorage.getItem('librarium:show_read_badges') !== 'false'
  )

  // Load persisted preferences from the server once on mount.
  useEffect(() => {
    callApi<{ prefs: Record<string, unknown> }>('/api/v1/auth/me/preferences')
      .then(({ prefs }) => {
        const cols = prefs[`library:${libraryId}:book_columns`]
        if (Array.isArray(cols)) {
          const valid = cols.filter((c): c is ColKey => (ALL_COLS as readonly string[]).includes(c as string))
          if (valid.length > 0) setVisibleCols(new Set(valid))
        }
        const pp = prefs[`library:${libraryId}:books_per_page`]
        if (typeof pp === 'number' && [25, 50, 100, 200].includes(pp)) {
          setPerPage(pp)
          setPage(1)
        }
        const vm = prefs[`library:${libraryId}:books_view_mode`]
        if (vm === 'table' || vm === 'grid') setViewMode(vm)
        const rb = prefs['show_read_badges']
        if (typeof rb === 'boolean') {
          setShowReadBadges(rb)
          localStorage.setItem('librarium:show_read_badges', String(rb))
        }
      })
      .catch(() => { /* silently fall back to localStorage values */ })
      .finally(() => { prefsReadyRef.current = true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally runs once on mount

  function patchPreference(key: string, value: unknown) {
    callApi('/api/v1/auth/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => {})
  }

  function setViewModeAndSave(mode: 'table' | 'grid') {
    setViewMode(mode)
    localStorage.setItem('librarium:books:viewMode', mode)
    if (prefsReadyRef.current) patchPreference(`library:${libraryId}:books_view_mode`, mode)
    if (mode === 'grid') setSelectedIds(new Set())
  }

  function toggleCol(col: ColKey) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col); else next.add(col)
      if (prefsReadyRef.current) {
        patchPreference(`library:${libraryId}:book_columns`, [...next])
      }
      return next
    })
  }

  useEffect(() => {
    if (!colPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setColPickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colPickerOpen])
  const [sort, setSort] = useState('title')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [availableLetters, setAvailableLetters] = useState<string[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [allGenres, setAllGenres] = useState<Genre[]>([])
  const [contribSuggestions, setContribSuggestions] = useState<{ label: string; insert: string; description: string }[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownIdx, setDropdownIdx] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Bulk metadata / cover refresh
  const [showBulkMetaModal, setShowBulkMetaModal] = useState(false)
  const [bulkMetaForce, setBulkMetaForce] = useState(false)
  const [bulkMetaUseAI, setBulkMetaUseAI] = useState(false)
  const [isBulkJobEnqueueing, setIsBulkJobEnqueueing] = useState(false)

  const pageIds = data?.items.map(b => b.id) ?? []
  const allOnPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id))
  const someOnPageSelected = !allOnPageSelected && pageIds.some(id => selectedIds.has(id))

  // ── Search dropdown helpers ──────────────────────────────────────────────────

  function getLastToken(q: string): string {
    // Find the last whitespace-delimited token (handles quoted strings)
    const m = q.match(/\S+$/)
    return m ? m[0] : ''
  }

  type Suggestion = { label: string; insert: string; description: string }

  function getSuggestions(currentToken: string): Suggestion[] {
    const lower = currentToken.toLowerCase()
    const colonIdx = lower.indexOf(':')

    if (colonIdx === -1) {
      // No field yet — show fields + operators, filtered by what user has typed
      const all: Suggestion[] = [
        { label: 'type:', insert: 'type:', description: 'Filter by media type' },
        { label: 'tag:', insert: 'tag:', description: 'Filter by tag' },
        { label: 'genre:', insert: 'genre:', description: 'Filter by genre' },
        { label: 'contributor:', insert: 'contributor:', description: 'Filter by author / contributor' },
        { label: 'series:', insert: 'series:', description: 'Filter by series name' },
        { label: 'shelf:', insert: 'shelf:', description: 'Filter by shelf name' },
        { label: 'publisher:', insert: 'publisher:', description: 'Filter by publisher' },
        { label: 'language:', insert: 'language:', description: 'Filter by language code (e.g. en, ja)' },
        { label: 'has:', insert: 'has:', description: 'Filter by property (e.g. has:cover)' },
        { label: 'NOT', insert: 'NOT ', description: 'Exclude the next term' },
        { label: 'OR', insert: 'OR ', description: 'Match any condition (default is AND)' },
      ]
      if (lower === '') return all
      return all.filter(s => s.label.toLowerCase().startsWith(lower))
    }

    const field = lower.slice(0, colonIdx)
    const valuePrefix = lower.slice(colonIdx + 1)

    if (field === 'type') {
      return mediaTypes
        .filter(mt => mt.display_name.toLowerCase().startsWith(valuePrefix))
        .map(mt => ({
          label: `type:${mt.display_name}`,
          insert: mt.display_name.includes(' ') ? `type:"${mt.display_name}"` : `type:${mt.display_name}`,
          description: '',
        }))
    }

    if (field === 'tag') {
      return allTags
        .filter(t => t.name.toLowerCase().startsWith(valuePrefix))
        .map(t => ({
          label: `tag:${t.name}`,
          insert: t.name.includes(' ') ? `tag:"${t.name}"` : `tag:${t.name}`,
          description: '',
        }))
    }

    if (field === 'contributor' || field === 'author') {
      return contribSuggestions.filter(s => s.label.toLowerCase().includes(valuePrefix))
    }

    if (field === 'has') {
      return [{ label: 'has:cover', insert: 'has:cover', description: 'Has a cover image' }]
        .filter(s => s.label.toLowerCase().startsWith(lower))
    }

    return []
  }

  function applySuggestion(insert: string) {
    const lastTok = getLastToken(query)
    const base = lastTok ? query.slice(0, query.lastIndexOf(lastTok)) : query
    const newQuery = (base + insert).replace(/\s+/g, ' ')
    setQuery(newQuery)
    setDropdownIdx(-1)
    // If suggestion ends with ':' keep dropdown open to show value options
    if (insert.endsWith(':') || insert.endsWith('" ') || insert.endsWith(' ')) {
      setShowDropdown(true)
    } else {
      setShowDropdown(false)
      setSearch(newQuery)
      setPage(1)
    }
    setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage), sort, sort_dir: sortDir })
      if (search) {
        // Send raw query to backend — the server parses the query language.
        params.set('q', search)
      }
      const result = await callApi<PagedBooks>(`/api/v1/libraries/${libraryId}/books?${params}`)
      setData(result)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load books')
    }
  }, [callApi, libraryId, page, perPage, search, sort, sortDir])

  // ── Background refresh ────────────────────────────────────────────────────────
  // Silently re-fetches the current view every 30 s while the tab is visible.
  // Only swaps state when the fingerprint (id+updated_at per book) changes, so
  // nothing re-renders unless data actually changed.

  const fingerprintRef = useRef('')
  useEffect(() => {
    fingerprintRef.current = (data?.items ?? []).map(b => `${b.id}:${b.updated_at}`).join(',')
  }, [data])

  const backgroundPoll = useCallback(async () => {
    if (document.hidden) return
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage), sort, sort_dir: sortDir })
      if (search) params.set('q', search)
      const result = await callApi<PagedBooks>(`/api/v1/libraries/${libraryId}/books?${params}`)
      const newFingerprint = (result?.items ?? []).map(b => `${b.id}:${b.updated_at}`).join(',')
      if (newFingerprint !== fingerprintRef.current) {
        fingerprintRef.current = newFingerprint
        setData(result)
      }
    } catch { /* ignore — foreground load handles errors */ }
  }, [callApi, libraryId, page, perPage, search, sort, sortDir])

  useEffect(() => {
    const INTERVAL_MS = 30_000
    let id: ReturnType<typeof setInterval> | null = null
    const start = () => { id = setInterval(backgroundPoll, INTERVAL_MS) }
    const stop  = () => { if (id !== null) { clearInterval(id); id = null } }
    const onVisibility = () => (document.hidden ? stop() : start())
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [backgroundPoll])

  // Check if a book matches any series in the library and queue a suggestion.
  // Called both after a new book is saved and when a duplicate is detected.
  const suggestSeriesForBook = useCallback(async (book: Book) => {
    try {
      const allSeries = await callApi<Series[]>(`/api/v1/libraries/${libraryId}/series`)
      if (!allSeries?.length) return
      const normalize = (s: string) => s.toLowerCase().replace(/×/g, 'x').replace(/[^a-z0-9]/g, '')
      const normalBook = normalize(book.title)
      for (const s of allSeries) {
        const normalSeries = normalize(s.name)
        if (normalSeries.length < 3) continue
        if (normalBook.includes(normalSeries)) {
          const volMatch = book.title.match(/(?:vol(?:ume)?\.?\s*|#\s*)(\d+)/i)
            ?? book.subtitle?.match(/(?:vol(?:ume)?\.?\s*|#\s*)(\d+)/i)
          const position = volMatch ? parseInt(volMatch[1]) : null
          setSeriesSuggestion({ book, series: s, position })
          return
        }
      }
    } catch { /* ignore */ }
  }, [callApi, libraryId])

  const handleBookSaved = useCallback((book: Book) => {
    setShowAdd(false)
    setEditBook(null)
    load()
    callApi<string[]>(`/api/v1/libraries/${libraryId}/books/letters`)
      .then(r => setAvailableLetters(r ?? []))
      .catch(() => {})
    // Only suggest for new books (not edits)
    if (!editBook) suggestSeriesForBook(book)
  }, [callApi, editBook, libraryId, load, suggestSeriesForBook])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    callApi<string[]>(`/api/v1/libraries/${libraryId}/books/letters`)
      .then(r => setAvailableLetters(r ?? []))
      .catch(() => {})
    callApi<Tag[]>(`/api/v1/libraries/${libraryId}/tags`)
      .then(r => setAllTags(r ?? []))
      .catch(() => {})
    callApi<Genre[]>('/api/v1/genres')
      .then(r => setAllGenres(r ?? []))
      .catch(() => {})
  }, [callApi, libraryId])

  // Async contributor typeahead — fires when query has contributor:<2+ chars>
  useEffect(() => {
    const lastTok = query.match(/\S+$/)?.[0] ?? ''
    const m = lastTok.match(/^(?:contributor|author):(.+)$/i)
    if (!m || m[1].length < 2) { setContribSuggestions([]); return }
    const prefix = m[1].startsWith('"') ? m[1].slice(1) : m[1]
    if (prefix.length < 2) { setContribSuggestions([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      callApi<{ id: string; name: string }[]>(`/api/v1/contributors?q=${encodeURIComponent(prefix)}`)
        .then(results => {
          if (cancelled) return
          setContribSuggestions((results ?? []).map(c => ({
            label: `contributor:${c.name}`,
            insert: c.name.includes(' ') ? `contributor:"${c.name}"` : `contributor:${c.name}`,
            description: '',
          })))
        })
        .catch(() => { if (!cancelled) setContribSuggestions([]) })
    }, 150)
    return () => { cancelled = true; clearTimeout(t) }
  }, [callApi, query])

  useEffect(() => { setSelectedIds(new Set()) }, [page, search])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(query)
  }

  const handleSort = (col: string) => {
    if (sort === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSort(col); setSortDir('asc') }
    setPage(1)
  }

  const handleLetterClick = (l: string) => {
    const parsed = parseSearchQuery(query)
    const letterCond = allConditions(parsed).find(c => c.field === 'letter')
    const activeLetter = letterCond?.value?.toUpperCase() ?? ''
    const newQuery = activeLetter === l
      ? removeFromQuery(query, letterCond!.raw)
      : upsertQueryToken(query, `letter:${l}`, /\bletter:\S+/gi)
    setQuery(newQuery)
    setSearch(newQuery)
    setPage(1)
  }

  const deleteBook = async (book: Book) => {
    if (!confirm(`Delete "${book.title}"? This cannot be undone.`)) return
    try {
      await callApi(`/api/v1/libraries/${libraryId}/books/${book.id}`, { method: 'DELETE' })
      load()
      callApi<string[]>(`/api/v1/libraries/${libraryId}/books/letters`)
        .then(r => setAvailableLetters(r ?? []))
        .catch(() => {})
    } catch { /* ignore */ }
  }

  const totalPages = data ? Math.ceil(data.total / perPage) : 1

  function bookPatchBody(book: Book, overrides: { media_type_id?: string; tag_ids?: string[]; genre_ids?: string[] }) {
    return {
      title:         book.title,
      subtitle:      book.subtitle,
      media_type_id: overrides.media_type_id ?? book.media_type_id,
      description:   book.description,
      contributors:  book.contributors.map(c => ({
        contributor_id: c.contributor_id,
        role:           c.role,
        display_order:  c.display_order,
      })),
      tag_ids:   overrides.tag_ids ?? book.tags.map(t => t.id),
      genre_ids: overrides.genre_ids ?? (book.genres ?? []).map(g => g.id),
    }
  }

  const applyBulk = async (transform: (book: Book) => object) => {
    if (!data) return
    const books = data.items.filter(b => selectedIds.has(b.id))
    setIsBulkApplying(true)
    for (const book of books) {
      try {
        await callApi(`/api/v1/libraries/${libraryId}/books/${book.id}`, {
          method: 'PUT',
          body: JSON.stringify(transform(book)),
        })
      } catch { /* skip individual errors */ }
    }
    setIsBulkApplying(false)
    setSelectedIds(new Set())
    load()
  }

  const bulkChangeType = (mediaTypeId: string) =>
    applyBulk(book => bookPatchBody(book, { media_type_id: mediaTypeId }))

  const bulkAddTag = (tagId: string) =>
    applyBulk(book => bookPatchBody(book, {
      tag_ids: book.tags.some(t => t.id === tagId)
        ? book.tags.map(t => t.id)
        : [...book.tags.map(t => t.id), tagId],
    }))

  const bulkRemoveTag = (tagId: string) =>
    applyBulk(book => bookPatchBody(book, {
      tag_ids: book.tags.filter(t => t.id !== tagId).map(t => t.id),
    }))

  const bulkAddGenre = (genreId: string) =>
    applyBulk(book => bookPatchBody(book, {
      genre_ids: (book.genres ?? []).some(g => g.id === genreId)
        ? (book.genres ?? []).map(g => g.id)
        : [...(book.genres ?? []).map(g => g.id), genreId],
    }))

  const bulkRemoveGenre = (genreId: string) =>
    applyBulk(book => bookPatchBody(book, {
      genre_ids: (book.genres ?? []).filter(g => g.id !== genreId).map(g => g.id),
    }))

  const bulkEnrichMetadata = async (force: boolean, useAICleanup: boolean) => {
    const bookIds = Array.from(selectedIds)
    setIsBulkJobEnqueueing(true)
    try {
      await callApi(`/api/v1/libraries/${libraryId}/books/bulk/enrich`, {
        method: 'POST',
        body: JSON.stringify({ book_ids: bookIds, force, use_ai_cleanup: useAICleanup }),
      })
      showToast(`Metadata refresh queued for ${bookIds.length} book${bookIds.length !== 1 ? 's' : ''}.`, {
        action: { label: 'View jobs', to: '/admin/settings/jobs' },
      })
    } catch { /* ignore */ }
    setIsBulkJobEnqueueing(false)
    setShowBulkMetaModal(false)
    setBulkMetaForce(false)
    setBulkMetaUseAI(false)
    setSelectedIds(new Set())
  }

  const bulkRefreshCovers = async () => {
    const bookIds = Array.from(selectedIds)
    setIsBulkApplying(true)
    try {
      await callApi(`/api/v1/libraries/${libraryId}/books/bulk/cover`, {
        method: 'POST',
        body: JSON.stringify({ book_ids: bookIds }),
      })
      showToast(`Cover refresh queued for ${bookIds.length} book${bookIds.length !== 1 ? 's' : ''}.`, {
        action: { label: 'View jobs', to: '/admin/settings/jobs' },
      })
    } catch { /* ignore */ }
    setIsBulkApplying(false)
    setSelectedIds(new Set())
  }

  const bulkDelete = async () => {
    if (!data) return
    if (!confirm(`Delete ${selectedIds.size} book${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return
    const books = data.items.filter(b => selectedIds.has(b.id))
    setIsBulkApplying(true)
    for (const book of books) {
      try {
        await callApi(`/api/v1/libraries/${libraryId}/books/${book.id}`, { method: 'DELETE' })
      } catch { /* skip */ }
    }
    setIsBulkApplying(false)
    setSelectedIds(new Set())
    load()
    callApi<string[]>(`/api/v1/libraries/${libraryId}/books/letters`)
      .then(r => setAvailableLetters(r ?? []))
      .catch(() => {})
  }

  // Computed here rather than in an IIFE inside the JSX. The old inline
  // version ran during render, which made every handler defined inside it
  // look like render-time work to react-hooks/refs, since applySuggestion
  // touches searchInputRef.
  const dropdownSuggestions = showDropdown ? getSuggestions(getLastToken(query)) : []

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <div className="relative flex-1">
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setShowDropdown(true); setDropdownIdx(-1) }}
              onFocus={() => { setShowDropdown(true); setDropdownIdx(-1) }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              onKeyDown={e => {
                const suggestions = getSuggestions(getLastToken(query))
                if (e.key === 'Escape') { setShowDropdown(false); setDropdownIdx(-1); return }
                if (!showDropdown || suggestions.length === 0) return
                if (e.key === 'ArrowDown') { e.preventDefault(); setDropdownIdx(i => Math.min(i + 1, suggestions.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setDropdownIdx(i => Math.max(i - 1, -1)) }
                else if (e.key === 'Enter' && dropdownIdx >= 0) { e.preventDefault(); applySuggestion(suggestions[dropdownIdx].insert) }
                else if (e.key === 'Tab') { e.preventDefault(); applySuggestion(suggestions[Math.max(dropdownIdx, 0)].insert) }
              }}
              placeholder='Search… type:Manga, tag:read, contributor:endo, NOT, OR, "phrase"'
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {showDropdown && dropdownSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
                {dropdownSuggestions.map((s, i) => (
                  <button
                    key={s.label}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); applySuggestion(s.insert) }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${i === dropdownIdx ? 'bg-blue-50 dark:bg-blue-950/50' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                  >
                    <span className="font-mono font-medium text-blue-600 dark:text-blue-400 min-w-[7rem]">{s.label}</span>
                    {s.description && <span className="text-xs text-gray-400 dark:text-gray-500">{s.description}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="submit"
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Search</button>
        </form>
        {/* View mode toggle */}
        <div className="flex items-center rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden flex-shrink-0">
          <button
            onClick={() => setViewModeAndSave('table')}
            className={`px-2.5 py-2 transition-colors ${viewMode === 'table' ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            title="Table view">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <button
            onClick={() => setViewModeAndSave('grid')}
            className={`px-2.5 py-2 transition-colors ${viewMode === 'grid' ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            title="Grid view">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
        </div>
        {/* Column picker — table mode only */}
        {viewMode === 'table' && (
        <div className="relative flex-shrink-0" ref={colPickerRef}>
          <button
            onClick={() => setColPickerOpen(o => !o)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-2.5 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            title="Choose columns">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
          </button>
          {colPickerOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1">
              {ALL_COLS.map(col => (
                <label key={col} className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                  <input type="checkbox" checked={visibleCols.has(col)}
                    onChange={() => toggleCol(col)}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600" />
                  {COL_LABELS[col]}
                </label>
              ))}
            </div>
          )}
        </div>
        )}
        {/* Exports whatever the toolbar is currently showing — the same
            search, filters and sort the list was loaded with. */}
        <ExportButton
          urlFor={format => booksExportUrl(libraryId, format, { q: search, sort, sortDir })}
          fallbackName="library-books"
          disabled={(data?.total ?? 0) === 0}
        />
        <Link to={`/import?library=${libraryId}`}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex-shrink-0">
          Import CSV
        </Link>
        <button onClick={() => setShowAdd(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors flex-shrink-0">
          Add book
        </button>
      </div>

      {(() => {
        const parsed = parseSearchQuery(search)
        const flat = allConditions(parsed)
        // Hide if it's just a single plain title search (no structured tokens)
        const hasStructured = flat.some(c => c.field !== 'title' || c.op === 'regex' || c.op === 'phrase' || c.op === 'not_contains')
        if (!hasStructured && flat.length <= 1) return null
        return (
          <div className="flex flex-wrap gap-1.5 mb-3 items-center">
            {parsed.groups.map((group, gi) =>
              group.conditions.map((c, ci) => {
                const isNeg = c.op.startsWith('not_')
                const chipColor = c.field === 'letter'
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-700'
                  : c.field === 'type'
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 ring-indigo-200 dark:ring-indigo-800'
                    : c.field === 'tag'
                      ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 ring-purple-200 dark:ring-purple-800'
                      : c.field === 'genre'
                        ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 ring-green-200 dark:ring-green-800'
                        : c.field === 'has'
                          ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 ring-teal-200 dark:ring-teal-800'
                          : isNeg
                        ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 ring-red-200 dark:ring-red-800'
                        : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 ring-blue-200 dark:ring-blue-800'
                return (
                  <Fragment key={`${gi}-${ci}`}>
                    {gi > 0 && ci === 0 && <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">AND</span>}
                    {ci > 0 && group.mode === 'OR' && <span className="text-xs text-orange-500 dark:text-orange-400 font-medium">OR</span>}
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${chipColor}`}>
                      {isNeg && <span className="font-bold">NOT</span>}
                      {conditionLabel(c)}
                      <button
                        type="button"
                        onClick={() => {
                          const next = removeFromQuery(search, c.raw)
                          setSearch(next); setQuery(next); setPage(1)
                        }}
                        className="ml-0.5 hover:opacity-75 transition-opacity leading-none"
                      >×</button>
                    </span>
                  </Fragment>
                )
              })
            )}
          </div>
        )
      })()}

      {availableLetters.length > 0 && (() => {
        const activeLetter = allConditions(parseSearchQuery(search)).find(c => c.field === 'letter')?.value?.toUpperCase() ?? ''
        return (
          <div className="flex flex-wrap gap-0.5 mb-3">
            {availableLetters.map(l => (
              <button key={l} type="button"
                onClick={() => handleLetterClick(l)}
                className={`w-7 h-7 rounded text-xs font-medium transition-colors ${activeLetter === l ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                {l}
              </button>
            ))}
          </div>
        )
      })()}

      {error && <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">{error}</div>}

      {!data && <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-16">Loading…</div>}

      {data?.items.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-12 text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{search ? 'No books match your search.' : 'No books yet'}</p>
          {!search && <button onClick={() => setShowAdd(true)}
            className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
            Add your first book
          </button>}
        </div>
      )}

      {selectedIds.size > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-2.5 text-sm">
            <span className="font-medium text-blue-700 dark:text-blue-300">
              {selectedIds.size} selected
            </span>
            <div className="h-4 w-px bg-blue-200 dark:bg-blue-700" />

            {/* Type */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-600 dark:text-gray-400">Type:</span>
              <select
                disabled={isBulkApplying}
                defaultValue=""
                onChange={async e => {
                  const id = e.target.value
                  if (!id) return
                  e.target.value = ''
                  await bulkChangeType(id)
                }}
                className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white px-2 py-0.5 text-xs focus:border-blue-500 focus:outline-none"
              >
                <option value="">Change type…</option>
                {mediaTypes.map(mt => <option key={mt.id} value={mt.id}>{mt.display_name}</option>)}
              </select>
            </div>

            {/* Tags */}
            {allTags.length > 0 && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Add tag:</span>
                  <select
                    disabled={isBulkApplying}
                    defaultValue=""
                    onChange={async e => {
                      const id = e.target.value
                      if (!id) return
                      e.target.value = ''
                      await bulkAddTag(id)
                    }}
                    className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white px-2 py-0.5 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Pick tag…</option>
                    {allTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Remove tag:</span>
                  <select
                    disabled={isBulkApplying}
                    defaultValue=""
                    onChange={async e => {
                      const id = e.target.value
                      if (!id) return
                      e.target.value = ''
                      await bulkRemoveTag(id)
                    }}
                    className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white px-2 py-0.5 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Pick tag…</option>
                    {allTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </>
            )}

            {/* Genres */}
            {allGenres.length > 0 && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Add genre:</span>
                  <select
                    disabled={isBulkApplying}
                    defaultValue=""
                    onChange={async e => {
                      const id = e.target.value
                      if (!id) return
                      e.target.value = ''
                      await bulkAddGenre(id)
                    }}
                    className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white px-2 py-0.5 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Pick genre…</option>
                    {allGenres.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Remove genre:</span>
                  <select
                    disabled={isBulkApplying}
                    defaultValue=""
                    onChange={async e => {
                      const id = e.target.value
                      if (!id) return
                      e.target.value = ''
                      await bulkRemoveGenre(id)
                    }}
                    className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white px-2 py-0.5 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Pick genre…</option>
                    {allGenres.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              </>
            )}

            <div className="h-4 w-px bg-blue-200 dark:bg-blue-700" />

            {/* Async bulk jobs */}
            <button
              type="button"
              disabled={isBulkApplying || isBulkJobEnqueueing}
              onClick={() => setShowBulkMetaModal(true)}
              className="text-xs text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 disabled:opacity-50 transition-colors"
            >
              Refresh metadata
            </button>
            <button
              type="button"
              disabled={isBulkApplying || isBulkJobEnqueueing}
              onClick={bulkRefreshCovers}
              className="text-xs text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 disabled:opacity-50 transition-colors"
            >
              Refresh covers
            </button>

            <div className="h-4 w-px bg-blue-200 dark:bg-blue-700" />

            <button
              type="button"
              disabled={isBulkApplying || isBulkJobEnqueueing}
              onClick={bulkDelete}
              className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
            >
              Delete
            </button>

            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Clear ×
            </button>

            {(isBulkApplying || isBulkJobEnqueueing) && (
              <span className="text-xs text-blue-600 dark:text-blue-400 animate-pulse">
                {isBulkJobEnqueueing ? 'Queuing…' : 'Applying…'}
              </span>
            )}
          </div>

          {/* Refresh metadata confirmation modal */}
          {showBulkMetaModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="w-full max-w-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-xl">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">
                  Refresh metadata
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Queue metadata enrichment for {selectedIds.size} book{selectedIds.size !== 1 ? 's' : ''}?
                  Books without an ISBN will be skipped.
                </p>
                <label className="flex items-start gap-2.5 mb-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={bulkMetaForce}
                    onChange={e => setBulkMetaForce(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Override existing fields
                    <span className="block text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                      When unchecked, only empty fields are filled in. When checked, provider data replaces existing values.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 mb-5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={bulkMetaUseAI}
                    onChange={e => setBulkMetaUseAI(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Clean descriptions with AI
                    <span className="block text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                      Strip marketing fluff and retailer boilerplate from each book's description after enrichment. Uses AI tokens.
                    </span>
                  </span>
                </label>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => { setShowBulkMetaModal(false); setBulkMetaForce(false); setBulkMetaUseAI(false) }}
                    className="rounded-lg px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isBulkJobEnqueueing}
                    onClick={() => bulkEnrichMetadata(bulkMetaForce, bulkMetaUseAI)}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {isBulkJobEnqueueing ? 'Queuing…' : 'Queue jobs'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {data && data.items.length > 0 && (
        <>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-4">
              {data.items.map(book => (
                <div key={book.id} className="group relative flex flex-col gap-2">
                  <div className="relative">
                    <Link to={`/libraries/${libraryId}/books/${book.id}`} className="block">
                      <BookCover title={book.title} coverUrl={book.cover_url} className="w-full"
                        readStatus={showReadBadges ? book.user_read_status : undefined} />
                    </Link>
                    {canEdit && (
                      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditBook(book)}
                          className="p-1 rounded bg-white/90 dark:bg-gray-900/90 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 shadow-sm transition-colors"
                          title="Edit book">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                        </button>
                        <button onClick={() => deleteBook(book)}
                          className="p-1 rounded bg-white/90 dark:bg-gray-900/90 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 shadow-sm transition-colors"
                          title="Delete book">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 px-0.5">
                    <Link to={`/libraries/${libraryId}/books/${book.id}`}
                      className="block text-xs font-medium text-gray-900 dark:text-white line-clamp-2 leading-snug hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                      {book.title}
                    </Link>
                    {book.contributors.length > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{book.contributors[0].name}</p>
                    )}
                    {(book.active_loan_count ?? 0) > 0 && (
                      <span className="mt-1 inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-800">
                        Lent
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="w-8 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      ref={el => { if (el) el.indeterminate = someOnPageSelected }}
                      onChange={e => {
                        if (e.target.checked) setSelectedIds(new Set(pageIds))
                        else setSelectedIds(new Set())
                      }}
                      className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  {([{ label: 'Title', col: 'title' }, ...(visibleCols.has('type') ? [{ label: 'Type', col: 'media_type' }] : [])]).map(({ label, col }) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <button type="button" onClick={() => handleSort(col)}
                        className="flex items-center gap-1 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                        {label}
                        {sort === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : <span className="opacity-0"> ↑</span>}
                      </button>
                    </th>
                  ))}
                  {visibleCols.has('tags') && <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Tags</th>}
                  {visibleCols.has('contributors') && <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Contributors</th>}
                  {visibleCols.has('series') && <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Series</th>}
                  {visibleCols.has('shelves') && <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Shelves</th>}
                  {visibleCols.has('date_added') && <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Date Added</th>}
                  {visibleCols.has('publisher') && <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Publisher</th>}
                  {visibleCols.has('published') && <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Published</th>}
                  {visibleCols.has('language') && <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Language</th>}
                  <th className="sticky right-0 px-4 py-3 bg-gray-50 dark:bg-gray-800" />
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.items.map(book => (
                  <tr key={book.id} className="group hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <td className="w-8 px-3 py-2" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(book.id)}
                        onChange={e => setSelectedIds(prev => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(book.id); else next.delete(book.id)
                          return next
                        })}
                        className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        <BookCoverThumb title={book.title} coverUrl={book.cover_url}
                          readStatus={showReadBadges ? book.user_read_status : undefined} />
                        <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link to={`/libraries/${libraryId}/books/${book.id}`}
                          className="font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                          {book.title}
                        </Link>
                        {(book.active_loan_count ?? 0) > 0 && (
                          <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-800">
                            Lent
                          </span>
                        )}
                      </div>
                      {book.subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-xs">{book.subtitle}</p>}
                      {book.genres?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {book.genres.map(genre => (
                            <button key={genre.id} type="button"
                              onClick={() => {
                                const genreToken = genre.name.includes(' ') ? `genre:"${genre.name}"` : `genre:${genre.name}`
                                const next = upsertQueryToken(query, genreToken, /\bgenre:(?:"[^"]*"|\S+)/gi)
                                setQuery(next); setSearch(next); setPage(1)
                              }}
                              className="rounded-full border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              title={`Filter by genre: ${genre.name}`}>
                              {genre.name}
                            </button>
                          ))}
                        </div>
                      )}
                        </div>{/* min-w-0 */}
                      </div>{/* flex items-center */}
                    </td>
                    {visibleCols.has('type') && (
                      <td className="px-4 py-2">
                        <button type="button"
                          onClick={() => {
                            const typeToken = book.media_type.includes(' ') ? `type:"${book.media_type}"` : `type:${book.media_type}`
                            const next = upsertQueryToken(query, typeToken, /\btype:(?:"[^"]*"|\S+)/gi)
                            setQuery(next); setSearch(next); setPage(1)
                          }}
                          className="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-600 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          title={`Filter by type: ${book.media_type}`}>
                          {book.media_type}
                        </button>
                      </td>
                    )}
                    {visibleCols.has('tags') && (
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {book.tags.map(tag => (
                            <button key={tag.id} type="button"
                              onClick={() => {
                                const tagToken = tag.name.includes(' ') ? `tag:"${tag.name}"` : `tag:${tag.name}`
                                const next = upsertQueryToken(query, tagToken, /\btag:(?:"[^"]*"|\S+)/gi)
                                setQuery(next); setSearch(next); setPage(1)
                              }}
                              className="rounded-full border border-transparent px-1.5 py-0.5 text-xs font-medium text-white transition-colors hover:border-blue-300 dark:hover:border-blue-400"
                              style={{ backgroundColor: tag.color || '#6b7280' }}
                              title={`Filter by tag: ${tag.name}`}>
                              {tag.name}
                            </button>
                          ))}
                          {!book.tags.length && <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </div>
                      </td>
                    )}
                    {visibleCols.has('contributors') && (
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400 text-xs">
                        {book.contributors.length > 0
                          ? (
                            <div className="flex flex-col gap-0.5">
                              {book.contributors.map((c, ci) => (
                                <span key={ci}>
                                  <button type="button"
                                    onClick={() => {
                                      const token = c.name.includes(' ') ? `contributor:"${c.name}"` : `contributor:${c.name}`
                                      const next = upsertQueryToken(query, token, /\bcontributor:(?:"[^"]*"|\S+)/gi)
                                      setQuery(next); setSearch(next); setPage(1)
                                    }}
                                    className="hover:underline hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    title={`Filter by contributor: ${c.name}`}>
                                    {c.name}
                                  </button>
                                  {' '}<span className="text-gray-400 dark:text-gray-500">({c.role.charAt(0).toUpperCase() + c.role.slice(1)})</span>
                                </span>
                              ))}
                            </div>
                          )
                          : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                    )}
                    {visibleCols.has('series') && (
                      <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400">
                        {book.series?.length > 0
                          ? <div className="flex flex-col gap-0.5">
                              {book.series.map(s => (
                                <span key={s.series_id} className="whitespace-nowrap">
                                  <button type="button"
                                    onClick={() => {
                                      const token = s.series_name.includes(' ') ? `series:"${s.series_name}"` : `series:${s.series_name}`
                                      const next = upsertQueryToken(query, token, /\bseries:(?:"[^"]*"|\S+)/gi)
                                      setQuery(next); setSearch(next); setPage(1)
                                    }}
                                    className="hover:underline hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    title={`Filter by series: ${s.series_name}`}>
                                    {s.series_name}
                                  </button>
                                  <span className="text-gray-400 dark:text-gray-500"> #{s.position}</span>
                                </span>
                              ))}
                            </div>
                          : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                    )}
                    {visibleCols.has('shelves') && (
                      <td className="px-4 py-2">
                        {book.shelves?.length > 0
                          ? <div className="flex flex-wrap gap-1">
                              {book.shelves.map(s => (
                                <button key={s.id} type="button"
                                  onClick={() => {
                                    const token = s.name.includes(' ') ? `shelf:"${s.name}"` : `shelf:${s.name}`
                                    const next = upsertQueryToken(query, token, /\bshelf:(?:"[^"]*"|\S+)/gi)
                                    setQuery(next); setSearch(next); setPage(1)
                                  }}
                                  className="rounded-full border border-gray-200 dark:border-gray-700 px-1.5 py-0.5 text-xs text-gray-600 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                  title={`Filter by shelf: ${s.name}`}>
                                  {s.name}
                                </button>
                              ))}
                            </div>
                          : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                    )}
                    {visibleCols.has('date_added') && (
                      <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {new Date(book.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                    )}
                    {visibleCols.has('publisher') && (
                      <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400 max-w-[10rem]">
                        {book.publisher
                          ? <button type="button"
                              onClick={() => {
                                const token = book.publisher.includes(' ') ? `publisher:"${book.publisher}"` : `publisher:${book.publisher}`
                                const next = upsertQueryToken(query, token, /\bpublisher:(?:"[^"]*"|\S+)/gi)
                                setQuery(next); setSearch(next); setPage(1)
                              }}
                              className="truncate max-w-full block hover:underline hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left"
                              title={`Filter by publisher: ${book.publisher}`}>
                              {book.publisher}
                            </button>
                          : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                    )}
                    {visibleCols.has('published') && (
                      <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400 tabular-nums">
                        {book.publish_year ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                    )}
                    {visibleCols.has('language') && (
                      <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400">
                        {book.language
                          ? <button type="button"
                              onClick={() => {
                                const next = upsertQueryToken(query, `language:${book.language}`, /\blanguage:(?:"[^"]*"|\S+)/gi)
                                setQuery(next); setSearch(next); setPage(1)
                              }}
                              className="hover:underline hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              title={`Filter by language: ${displayLanguage(book.language)}`}>
                              {displayLanguage(book.language)}
                            </button>
                          : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                    )}
                    <td className="sticky right-0 px-4 py-2 bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800 transition-colors">
                      <div className="flex items-center gap-1 justify-end">
                        {canEdit && (
                          <>
                            <button onClick={() => setEditBook(book)}
                              className="p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                              title="Edit book">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                              </svg>
                            </button>
                            <button onClick={() => deleteBook(book)}
                              className="p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Delete book">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {data && data.total > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{data.total} book{data.total !== 1 ? 's' : ''} · Page {page} of {totalPages}</span>
              <div className="flex items-center gap-2">
                <select
                  value={perPage}
                  onChange={e => {
                    const n = Number(e.target.value)
                    localStorage.setItem('librarium:books:perPage', String(n))
                    setPerPage(n)
                    setPage(1)
                    if (prefsReadyRef.current) patchPreference(`library:${libraryId}:books_per_page`, n)
                  }}
                  className="rounded border border-gray-300 dark:border-gray-600 bg-transparent px-1.5 py-1 text-xs text-gray-600 dark:text-gray-300 focus:outline-none"
                >
                  {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page === 1}
                  className="rounded px-2 py-1 border border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">«</button>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="rounded px-2 py-1 border border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">‹</button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  // show pages around current page
                  let p: number
                  if (totalPages <= 7) p = i + 1
                  else if (page <= 4) p = i + 1
                  else if (page >= totalPages - 3) p = totalPages - 6 + i
                  else p = page - 3 + i
                  return (
                    <button key={p} onClick={() => setPage(p)} disabled={p === page}
                      className={`rounded px-2.5 py-1 border transition-colors ${p === page ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-40'}`}>
                      {p}
                    </button>
                  )
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="rounded px-2 py-1 border border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">›</button>
                <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                  className="rounded px-2 py-1 border border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">»</button>
              </div>
              </div>
            </div>
          )}
        </>
      )}

      {showAdd && (
        <AddBookModal
          libraryId={libraryId}
          mediaTypes={mediaTypes}
          onClose={() => setShowAdd(false)}
          onSaved={handleBookSaved}
          onDuplicate={suggestSeriesForBook}
          initialIsbn={addInitialIsbn || undefined}
          initialTitle={addInitialTitle || undefined}
        />
      )}
      {editBook && (
        <EditBookModal
          libraryId={libraryId}
          book={editBook}
          onClose={() => setEditBook(null)}
          onSaved={book => { setEditBook(null); handleBookSaved(book) }}
        />
      )}

      {seriesSuggestion && !showAdd && !editBook && (
        <SeriesLinkSuggestionModal
          libraryId={libraryId}
          book={seriesSuggestion.book}
          series={seriesSuggestion.series}
          suggestedPosition={seriesSuggestion.position}
          onClose={() => setSeriesSuggestion(null)}
        />
      )}

    </div>
  )
}

// ─── Series link suggestion modal ────────────────────────────────────────────

interface SeriesLinkSuggestionModalProps {
  libraryId: string
  book: Book
  series: Series
  suggestedPosition: number | null
  onClose: () => void
}

function SeriesLinkSuggestionModal({ libraryId, book, series, suggestedPosition, onClose }: SeriesLinkSuggestionModalProps) {
  const { callApi } = useAuth()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
  const [position, setPosition] = useState(suggestedPosition != null ? String(suggestedPosition) : '')
  const [isSaving, setIsSaving] = useState(false)

  const handleAdd = async () => {
    setIsSaving(true)
    try {
      await callApi(`/api/v1/libraries/${libraryId}/series/${series.id}/books`, {
        method: 'POST',
        body: JSON.stringify({ book_id: book.id, position: Number(position) || 1 }),
      })
      onClose()
    } catch { /* ignore */ } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-900 shadow-xl p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Add to series?</h3>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          <span className="font-medium text-gray-900 dark:text-white">{book.title}</span> looks like it belongs to{' '}
          <span className="font-medium text-gray-900 dark:text-white">{series.name}</span>.
        </p>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Volume position</label>
          <input type="number" min="0" step="0.5" value={position} onChange={e => setPosition(e.target.value)}
            placeholder="e.g. 1, 2, 1.5"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Not now
          </button>
          <button type="button" onClick={handleAdd} disabled={!position || isSaving}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {isSaving ? 'Adding…' : 'Add to series'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Series tab ───────────────────────────────────────────────────────────────

const formatPosition = (pos: number) => pos % 1 === 0 ? pos.toFixed(0) : pos.toFixed(1)

const TOTAL_SERIES_FIELDS = 9

function countSeriesLookupFields(r: SeriesLookupResult): number {
  return [
    !!r.description,
    r.total_count != null,
    !!r.status,
    !!r.original_language,
    r.publication_year != null,
    !!r.demographic,
    (r.genres?.length ?? 0) > 0,
    !!r.url,
    !!r.cover_url,
  ].filter(Boolean).length
}

// ─── Series merge helpers ─────────────────────────────────────────────────────

interface SeriesFieldOption<T> {
  value: T
  sources: string[]          // e.g. ["MangaDex", "Hardcover"] or ["Current"]
  isCurrent?: boolean
}

function normalizeSeriesName(s: string): string {
  return s.trim().toLowerCase()
}

// mergeString returns unique (case-insensitive, trimmed) option rows for a
// string field, preserving original casing from the first occurrence and
// aggregating source labels on exact-after-normalize matches.
function mergeString(
  current: string | undefined,
  entries: Array<{ source: string; value: string | undefined | null }>,
): SeriesFieldOption<string>[] {
  const out: SeriesFieldOption<string>[] = []
  const byKey = new Map<string, SeriesFieldOption<string>>()
  if (current && current.trim()) {
    const opt: SeriesFieldOption<string> = { value: current, sources: ['Current'], isCurrent: true }
    byKey.set(current.trim().toLowerCase(), opt)
    out.push(opt)
  }
  for (const e of entries) {
    const v = (e.value ?? '').trim()
    if (!v) continue
    const key = v.toLowerCase()
    const existing = byKey.get(key)
    if (existing) {
      if (!existing.sources.includes(e.source)) existing.sources.push(e.source)
    } else {
      const opt: SeriesFieldOption<string> = { value: e.value ?? '', sources: [e.source] }
      byKey.set(key, opt)
      out.push(opt)
    }
  }
  return out
}

function mergeNumber(
  current: number | null | undefined,
  entries: Array<{ source: string; value: number | null | undefined }>,
): SeriesFieldOption<number | null>[] {
  const out: SeriesFieldOption<number | null>[] = []
  const byKey = new Map<string, SeriesFieldOption<number | null>>()
  if (current != null) {
    const opt: SeriesFieldOption<number | null> = { value: current, sources: ['Current'], isCurrent: true }
    byKey.set(String(current), opt)
    out.push(opt)
  }
  for (const e of entries) {
    if (e.value == null) continue
    const key = String(e.value)
    const existing = byKey.get(key)
    if (existing) {
      if (!existing.sources.includes(e.source)) existing.sources.push(e.source)
    } else {
      const opt: SeriesFieldOption<number | null> = { value: e.value, sources: [e.source] }
      byKey.set(key, opt)
      out.push(opt)
    }
  }
  return out
}

function mergeGenres(
  current: string[],
  entries: Array<{ source: string; value: string[] | undefined }>,
): SeriesFieldOption<string[]>[] {
  const key = (arr: string[]) => [...arr].map(s => s.trim().toLowerCase()).sort().join('|')
  const out: SeriesFieldOption<string[]>[] = []
  const byKey = new Map<string, SeriesFieldOption<string[]>>()
  if (current.length > 0) {
    const opt: SeriesFieldOption<string[]> = { value: current, sources: ['Current'], isCurrent: true }
    byKey.set(key(current), opt)
    out.push(opt)
  }
  for (const e of entries) {
    if (!e.value || e.value.length === 0) continue
    const k = key(e.value)
    const existing = byKey.get(k)
    if (existing) {
      if (!existing.sources.includes(e.source)) existing.sources.push(e.source)
    } else {
      const opt: SeriesFieldOption<string[]> = { value: e.value, sources: [e.source] }
      byKey.set(k, opt)
      out.push(opt)
    }
  }
  return out
}

// Sort so options with more sources come first, then current-first, then stable.
function sortOptions<T>(opts: SeriesFieldOption<T>[]): SeriesFieldOption<T>[] {
  return [...opts].sort((a, b) => {
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length
    if (!!b.isCurrent !== !!a.isCurrent) return a.isCurrent ? -1 : 1
    return 0
  })
}

interface SeriesFormModalProps {
  libraryId: string
  series?: Series | null
  onClose: () => void
  onSaved: () => void
}

function SeriesFormModal({ libraryId, series, onClose, onSaved }: SeriesFormModalProps) {
  const { callApi } = useAuth()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Only show search mode when creating a new series
  const [mode, setMode] = useState<'search' | 'manual'>(series ? 'manual' : 'search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SeriesLookupResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: series?.name ?? '',
    description: series?.description ?? '',
    total_count: series?.total_count != null ? String(series.total_count) : '',
    status: series?.status ?? 'ongoing',
    original_language: series?.original_language ?? '',
    publication_year: series?.publication_year != null ? String(series.publication_year) : '',
    demographic: series?.demographic ?? '',
    genres: series?.genres ?? [] as string[],
    url: series?.url ?? '',
    external_id: series?.external_id ?? '',
    external_source: series?.external_source ?? '',
  })
  const [libraryTags, setLibraryTags] = useState<Tag[]>([])
  const [selectedTags, setSelectedTags] = useState<Tag[]>(series?.tags ?? [])
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#6b7280')
  const [showNewTag, setShowNewTag] = useState(false)
  const [isCreatingTag, setIsCreatingTag] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    callApi<Tag[]>(`/api/v1/libraries/${libraryId}/tags`).then(ts => setLibraryTags(ts ?? [])).catch(() => {})
  }, [callApi, libraryId])

  const createTag = async () => {
    if (!newTagName.trim()) return
    setIsCreatingTag(true)
    try {
      const tag = await callApi<Tag>(`/api/v1/libraries/${libraryId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      })
      if (tag) { setLibraryTags(ts => [...ts, tag]); setSelectedTags(ts => [...ts, tag]) }
      setNewTagName(''); setShowNewTag(false)
    } catch { /* ignore */ }
    finally { setIsCreatingTag(false) }
  }

  const doSearch = async () => {
    if (!searchQuery.trim()) return
    setSearchLoading(true)
    setSearchError(null)
    setSearchResults([])
    try {
      const results = await callApi<SeriesLookupResult[]>(
        `/api/v1/lookup/series?q=${encodeURIComponent(searchQuery.trim())}`
      )
      setSearchResults(results ?? [])
      if (!results || results.length === 0) setSearchError('No results found.')
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : 'Search failed')
    } finally {
      setSearchLoading(false)
    }
  }

  const importResult = (r: SeriesLookupResult) => {
    setForm({
      name: r.name || '',
      description: r.description || '',
      total_count: r.total_count != null ? String(r.total_count) : '',
      status: r.status || (r.is_complete ? 'completed' : 'ongoing'),
      original_language: r.original_language || '',
      publication_year: r.publication_year != null ? String(r.publication_year) : '',
      demographic: r.demographic || '',
      genres: r.genres ?? [],
      url: r.url || '',
      external_id: r.external_id || '',
      external_source: r.external_source || '',
    })
    setMode('manual')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setIsLoading(true)
    try {
      const body = {
        name: form.name,
        description: form.description,
        total_count: form.total_count ? Number(form.total_count) : null,
        status: form.status,
        original_language: form.original_language,
        publication_year: form.publication_year ? Number(form.publication_year) : null,
        demographic: form.demographic,
        genres: form.genres,
        url: form.url,
        external_id: form.external_id,
        external_source: form.external_source,
        tag_ids: selectedTags.map(t => t.id),
      }
      const url = series
        ? `/api/v1/libraries/${libraryId}/series/${series.id}`
        : `/api/v1/libraries/${libraryId}/series`
      await callApi(url, { method: series ? 'PUT' : 'POST', body: JSON.stringify(body) })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save series')
    } finally { setIsLoading(false) }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-16 px-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 shadow-xl">
        {/* Header with tab switcher (new series only) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {series ? 'Edit series' : 'New series'}
          </h3>
          <div className="flex items-center gap-2">
            {!series && (
              <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
                <button type="button" onClick={() => setMode('search')}
                  className={`px-3 py-1 transition-colors ${mode === 'search' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                  Search
                </button>
                <button type="button" onClick={() => setMode('manual')}
                  className={`px-3 py-1 transition-colors ${mode === 'manual' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                  Manual
                </button>
              </div>
            )}
            <button type="button" onClick={onClose}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Close">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          {/* ── Search mode ── */}
          {mode === 'search' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  placeholder="e.g. One Piece, Bleach, Naruto…"
                  className={inputCls}
                />
                <button type="button" onClick={doSearch} disabled={searchLoading || !searchQuery.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {searchLoading ? '…' : 'Search'}
                </button>
              </div>

              {searchError && <p className="text-sm text-red-600 dark:text-red-400">{searchError}</p>}
              {searchLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Searching providers…</p>}

              {searchResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                  </p>
                  {searchResults.map((r, i) => (
                    <button key={i} type="button" onClick={() => importResult(r)}
                      className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors">
                      <div className="flex gap-3 items-start">
                        {r.cover_url && (
                          <img src={r.cover_url} alt="" referrerPolicy="no-referrer" className="w-10 h-14 object-cover rounded flex-shrink-0 bg-gray-200 dark:bg-gray-700" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{r.name}</p>
                          {r.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{r.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {r.total_count != null && (
                              <span className="text-xs text-gray-400 dark:text-gray-500">{r.total_count} vols</span>
                            )}
                            {r.status && (
                              <span className={`text-xs rounded-full px-1.5 py-0.5 ${r.status === 'completed' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' : r.status === 'hiatus' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' : r.status === 'cancelled' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'}`}>
                                {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                              </span>
                            )}
                            {r.demographic && (
                              <span className="text-xs text-gray-400 dark:text-gray-500">{r.demographic}</span>
                            )}
                            {r.original_language && (
                              <span className="text-xs text-gray-400 dark:text-gray-500">{r.original_language}</span>
                            )}
                            <span className="text-xs text-gray-400 dark:text-gray-500">via {r.provider_display}</span>
                          </div>
                          {r.genres && r.genres.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {r.genres.slice(0, 5).map(g => (
                                <span key={g} className="text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5">{g}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <button type="button" onClick={() => setMode('manual')}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Add manually instead →
              </button>
            </div>
          )}

          {/* ── Manual mode ── */}
          {mode === 'manual' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                <input type="text" autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Attack on Titan" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3} placeholder="Optional"
                  className={`${inputCls} resize-none`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Total volumes</label>
                  <input type="number" min="1" value={form.total_count}
                    onChange={e => setForm(f => ({ ...f, total_count: e.target.value }))}
                    placeholder="e.g. 34" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className={inputCls}>
                    <option value="ongoing">Ongoing</option>
                    <option value="completed">Completed</option>
                    <option value="hiatus">Hiatus</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Original language</label>
                  <input type="text" list="series-language-list" value={form.original_language}
                    onChange={e => setForm(f => ({ ...f, original_language: e.target.value.toLowerCase() }))}
                    placeholder="e.g. ja" className={inputCls} />
                  <datalist id="series-language-list">
                    {LANGUAGE_OPTIONS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Publication year</label>
                  <input type="number" min="1900" max="2100" value={form.publication_year}
                    onChange={e => setForm(f => ({ ...f, publication_year: e.target.value }))}
                    placeholder="e.g. 2019" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Demographic</label>
                <select value={form.demographic} onChange={e => setForm(f => ({ ...f, demographic: e.target.value }))}
                  className={inputCls}>
                  <option value="">—</option>
                  <option value="shounen">Shounen</option>
                  <option value="shoujo">Shoujo</option>
                  <option value="josei">Josei</option>
                  <option value="seinen">Seinen</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {form.genres.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Genres</label>
                  <div className="flex flex-wrap gap-1.5">
                    {form.genres.map(g => (
                      <span key={g} className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300">{g}</span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tags</label>
                  <button type="button" onClick={() => setShowNewTag(v => !v)}
                    className="text-xs text-blue-600 hover:underline">+ New tag</button>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                  {libraryTags.map(tag => {
                    const selected = selectedTags.some(t => t.id === tag.id)
                    return (
                      <button key={tag.id} type="button"
                        onClick={() => setSelectedTags(ts => selected ? ts.filter(t => t.id !== tag.id) : [...ts, tag])}
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-all ${
                          selected ? 'ring-transparent text-white' : 'bg-white dark:bg-gray-800 ring-gray-300 dark:ring-gray-600 text-gray-600 dark:text-gray-300 hover:ring-gray-400'
                        }`}
                        style={selected ? { backgroundColor: tag.color || '#6b7280' } : tag.color ? { color: tag.color } : undefined}>
                        {tag.name}
                      </button>
                    )
                  })}
                  {libraryTags.length === 0 && !showNewTag && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">No tags in this library yet.</p>
                  )}
                </div>
                {showNewTag && (
                  <div className="mt-2 flex items-center gap-2">
                    <input type="text" value={newTagName} onChange={e => setNewTagName(e.target.value)}
                      placeholder="Tag name"
                      className="flex-1 h-8 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-2 text-xs focus:border-blue-500 focus:outline-none" />
                    <select value={newTagColor} onChange={e => setNewTagColor(e.target.value)}
                      className="h-8 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-2 text-xs focus:border-blue-500 focus:outline-none">
                      {TAG_COLORS.filter(c => c.value).map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                    <button type="button" disabled={isCreatingTag || !newTagName.trim()}
                      onClick={createTag}
                      className="h-8 px-3 rounded bg-blue-600 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">Add</button>
                    <button type="button" onClick={() => setShowNewTag(false)}
                      className="h-8 px-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Website URL</label>
                <input type="url" value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="e.g. https://www.viz.com/one-piece" className={inputCls} />
              </div>
              {error && <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-400">{error}</div>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={onClose}
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={isLoading || !form.name.trim()}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {isLoading ? 'Saving…' : series ? 'Save changes' : 'Create'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

interface AddToSeriesModalProps {
  libraryId: string
  seriesId: string
  existingBookIds: string[]
  editEntry?: SeriesEntry | null
  /** Pre-fill the position field (e.g. when opening from a ghost row). */
  initialPosition?: number
  /** Pre-fill and auto-run the book search (e.g. series name + vol number). */
  initialQuery?: string
  onClose: () => void
  onSaved: () => void
}

function AddToSeriesModal({ libraryId, seriesId, existingBookIds, editEntry, initialPosition, initialQuery, onClose, onSaved }: AddToSeriesModalProps) {
  const { callApi } = useAuth()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
  const [query, setQuery] = useState(initialQuery ?? '')
  const [results, setResults] = useState<Book[]>([])
  const [selected, setSelected] = useState<{ id: string; title: string } | null>(
    editEntry ? { id: editEntry.book_id, title: editEntry.title } : null
  )
  const [position, setPosition] = useState(
    editEntry ? String(editEntry.position) : initialPosition != null ? String(initialPosition) : ''
  )
  const [isSearching, setIsSearching] = useState(false)
  const isFirstRun = useRef(true)

  // Live search: immediate on first render (pre-filled query), 300 ms debounce after that.
  useEffect(() => {
    if (!query) { setResults([]); return }
    const delay = isFirstRun.current ? 0 : 300
    isFirstRun.current = false
    const t = setTimeout(() => {
      setIsSearching(true)
      callApi<PagedBooks>(`/api/v1/libraries/${libraryId}/books?q=${encodeURIComponent(query)}&per_page=20`)
        .then(data => setResults((data?.items ?? []).filter(b => !existingBookIds.includes(b.id) || editEntry?.book_id === b.id)))
        .catch(() => {})
        .finally(() => setIsSearching(false))
    }, delay)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return
    await callApi(`/api/v1/libraries/${libraryId}/series/${seriesId}/books`, {
      method: 'POST',
      body: JSON.stringify({ book_id: selected.id, position: Number(position) || 1 }),
    }).catch(() => {})
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-900 shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {editEntry ? 'Edit position' : 'Add book to series'}
          </h3>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          {!editEntry && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Book *</label>
              {selected ? (
                <div className="flex items-center gap-2 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
                  <span className="flex-1 text-sm text-gray-900 dark:text-white truncate">{selected.title}</span>
                  <button type="button" onClick={() => { setSelected(null); setQuery('') }}
                    className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
                </div>
              ) : (
                <input type="text" autoFocus value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search books…"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              )}
              {isSearching && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Searching…</p>}
              {!isSearching && results.length > 0 && !selected && (
                <ul className="mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow max-h-52 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                  {results.map(b => (
                    <li key={b.id}>
                      <button type="button" onClick={() => { setSelected({ id: b.id, title: b.title }); setResults([]) }}
                        className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
                        <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug">{b.title}</p>
                        {b.contributors.length > 0 && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {b.contributors.filter(c => c.role === 'author').map(c => c.name).join(', ') || b.contributors.map(c => c.name).join(', ')}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Position *</label>
            <input type="number" autoFocus={!!editEntry} min="0" step="0.5" value={position}
              onChange={e => setPosition(e.target.value)}
              placeholder="e.g. 1, 2, 1.5"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Cancel</button>
            <button type="submit" disabled={!selected || !position}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {editEntry ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Auto-match modal ─────────────────────────────────────────────────────────

interface AutoMatchModalProps {
  series: Series
  libraryId: string
  onClose: () => void
  onApplied: () => void
}

function AutoMatchModal({ series, libraryId, onClose, onApplied }: AutoMatchModalProps) {
  const { callApi } = useAuth()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  type Row = SeriesMatchCandidate & { selected: boolean; positionStr: string }
  const [rows, setRows] = useState<Row[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    callApi<SeriesMatchCandidate[]>(
      `/api/v1/libraries/${libraryId}/series/${series.id}/match-candidates`
    ).then(list => {
      if (cancelled) return
      setRows((list ?? []).map(c => ({ ...c, selected: true, positionStr: String(c.position) })))
    }).catch(err => {
      if (cancelled) return
      setError(err instanceof ApiError ? err.message : 'Failed to load candidates')
    }).finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (i: number) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, selected: !r.selected } : r))
  const setPos = (i: number, v: string) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, positionStr: v } : r))
  const toggleAll = (checked: boolean) => setRows(rs => rs.map(r => ({ ...r, selected: checked })))

  const selectedCount = rows.filter(r => r.selected).length
  const allSelected = rows.length > 0 && selectedCount === rows.length

  const apply = async () => {
    const matches = rows
      .filter(r => r.selected)
      .map(r => ({ book_id: r.book_id, position: Number(r.positionStr) }))
      .filter(m => !Number.isNaN(m.position) && m.position > 0)
    if (matches.length === 0) return
    setIsSaving(true)
    try {
      await callApi(`/api/v1/libraries/${libraryId}/series/${series.id}/match-apply`, {
        method: 'POST',
        body: JSON.stringify({ matches }),
      })
      onApplied()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to apply matches')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-16 px-4">
      <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-gray-900 shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Auto-match books to series</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Library books whose title starts with "{series.name}" followed by a number.
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4">
          {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">Scanning library…</p>}
          {!isLoading && error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
          {!isLoading && !error && rows.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
              No matching books found. Book titles need to start with "{series.name}" followed by a volume number (e.g. "{series.name} #1" or "{series.name}, Vol. 3").
            </p>
          )}
          {!isLoading && rows.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={allSelected}
                    onChange={e => toggleAll(e.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                  Select all
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedCount} of {rows.length} selected
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 w-8" />
                      <th className="px-3 py-2 w-20 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Vol #</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Title</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {rows.map((r, i) => (
                      <tr key={r.book_id} className={r.selected ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-950 opacity-60'}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={r.selected}
                            onChange={() => toggle(i)}
                            className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="0" step="0.5" value={r.positionStr}
                            onChange={e => setPos(i, e.target.value)}
                            disabled={!r.selected}
                            className="w-16 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50" />
                        </td>
                        <td className="px-3 py-2">
                          <p className="text-gray-900 dark:text-white">{r.title}</p>
                          {r.other_series.length > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                              Already in: {r.other_series.map(o => o.series_name).join(', ')}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={apply} disabled={selectedCount === 0 || isSaving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {isSaving ? 'Applying…' : `Apply ${selectedCount} match${selectedCount === 1 ? '' : 'es'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Suggest series modal ─────────────────────────────────────────────────────

interface SuggestSeriesModalProps {
  libraryId: string
  onClose: () => void
  onCreated: (count: number) => void
}

type SuggestionRow = {
  proposedName: string
  normalized: string
  include: boolean
  books: Array<{
    book_id: string
    title: string
    subtitle: string
    cover_url: string | null
    selected: boolean
    positionStr: string
  }>
}

function SuggestSeriesModal({ libraryId, onClose, onCreated }: SuggestSeriesModalProps) {
  const { callApi } = useAuth()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const [rows, setRows] = useState<SuggestionRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    callApi<SeriesSuggestion[]>(`/api/v1/libraries/${libraryId}/series/suggest`)
      .then(list => {
        if (cancelled) return
        setRows((list ?? []).map((s, idx) => ({
          proposedName: s.proposed_name,
          normalized: `${idx}-${s.proposed_name}`,
          include: true,
          books: s.books.map(b => ({
            book_id: b.book_id,
            title: b.title,
            subtitle: b.subtitle,
            cover_url: b.cover_url,
            selected: true,
            positionStr: String(b.position),
          })),
        })))
      })
      .catch(err => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load suggestions') })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setName = (i: number, v: string) =>
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, proposedName: v } : r))
  const toggleSeries = (i: number) =>
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, include: !r.include } : r))
  const toggleBook = (i: number, j: number) =>
    setRows(rs => rs.map((r, idx) => idx === i
      ? { ...r, books: r.books.map((b, bi) => bi === j ? { ...b, selected: !b.selected } : b) }
      : r))
  const setBookPos = (i: number, j: number, v: string) =>
    setRows(rs => rs.map((r, idx) => idx === i
      ? { ...r, books: r.books.map((b, bi) => bi === j ? { ...b, positionStr: v } : b) }
      : r))

  const includedCount = rows.filter(r => r.include && r.proposedName.trim() !== '' && r.books.some(b => b.selected)).length
  const totalBookCount = rows.reduce((s, r) => r.include ? s + r.books.filter(b => b.selected).length : s, 0)

  const apply = async () => {
    const payload = {
      series: rows
        .filter(r => r.include && r.proposedName.trim() !== '')
        .map(r => ({
          name: r.proposedName.trim(),
          books: r.books
            .filter(b => b.selected)
            .map(b => ({ book_id: b.book_id, position: Number(b.positionStr) }))
            .filter(b => !Number.isNaN(b.position) && b.position > 0),
        }))
        .filter(s => s.books.length > 0),
    }
    if (payload.series.length === 0) return
    setIsSaving(true)
    try {
      const resp = await callApi<{ created: number }>(
        `/api/v1/libraries/${libraryId}/series/bulk-create`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      onCreated(resp?.created ?? 0)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create series')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-16 px-4">
      <div className="w-full max-w-3xl rounded-xl bg-white dark:bg-gray-900 shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Suggest series</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Groups of un-grouped books whose titles share a base name plus a volume number. Defaults to manga-ish formats.
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4">
          {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">Scanning library…</p>}
          {!isLoading && error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
          {!isLoading && !error && rows.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
              Nothing to suggest. Either every book is already in a series, or no groups of 2+ with volume numbers were found.
            </p>
          )}
          {!isLoading && rows.length > 0 && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
              {rows.map((r, i) => (
                <div key={r.normalized}
                  className={`rounded-lg border ${r.include ? 'border-gray-200 dark:border-gray-700' : 'border-gray-100 dark:border-gray-800 opacity-60'} bg-white dark:bg-gray-900`}>
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                    <input type="checkbox" checked={r.include} onChange={() => toggleSeries(i)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <input type="text" value={r.proposedName} onChange={e => setName(i, e.target.value)}
                      className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-2 py-1 text-sm font-semibold focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {r.books.filter(b => b.selected).length}/{r.books.length} books
                    </span>
                  </div>
                  {r.include && (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {r.books.map((b, j) => (
                        <li key={b.book_id} className="flex items-center gap-3 px-4 py-2">
                          <input type="checkbox" checked={b.selected} onChange={() => toggleBook(i, j)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          {b.cover_url ? (
                            <img src={b.cover_url} alt=""
                              className="h-10 w-7 flex-shrink-0 rounded object-cover bg-gray-100 dark:bg-gray-800" />
                          ) : (
                            <div className="h-10 w-7 flex-shrink-0 rounded bg-gray-100 dark:bg-gray-800" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900 dark:text-white truncate">{b.title}</p>
                            {b.subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{b.subtitle}</p>}
                          </div>
                          <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                            #
                            <input type="number" step="0.5" min="0" value={b.positionStr}
                              onChange={e => setBookPos(i, j, e.target.value)}
                              className="w-16 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-2 py-1 text-xs text-right focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {includedCount > 0 ? `${includedCount} series, ${totalBookCount} books` : 'Nothing selected'}
          </p>
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
            <button type="button" onClick={apply} disabled={includedCount === 0 || isSaving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {isSaving ? 'Creating…' : `Create ${includedCount} series`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Series metadata search modal ─────────────────────────────────────────────

interface SeriesMetadataSearchModalProps {
  series: Series
  libraryId: string
  onClose: () => void
  onSaved: (updated: Series) => void
}

function SeriesMetadataSearchModal({ series, libraryId, onClose, onSaved }: SeriesMetadataSearchModalProps) {
  const { callApi } = useAuth()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
  const [results, setResults] = useState<SeriesLookupResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<SeriesLookupResult | null>(null)

  useEffect(() => {
    const search = async () => {
      try {
        const list = await callApi<SeriesLookupResult[]>(
          `/api/v1/lookup/series?q=${encodeURIComponent(series.name)}`
        )
        const sorted = (list ?? []).sort((a, b) => countSeriesLookupFields(b) - countSeriesLookupFields(a))
        setResults(sorted)
        if (!list || list.length === 0) setError('No results found.')
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Search failed')
      } finally {
        setIsLoading(false)
      }
    }
    search()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fieldBadgeCls = (n: number) =>
    n >= 7 ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
    : n >= 4 ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'

  if (picked) {
    const matching = results.filter(r => normalizeSeriesName(r.name) === normalizeSeriesName(picked.name))
    return (
      <SeriesMergeView
        series={series}
        libraryId={libraryId}
        primary={picked}
        matching={matching}
        onBack={() => setPicked(null)}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-16 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Search metadata providers</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Pick the best match for "{series.name}" — then review fields.
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-3">
          {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">Searching providers…</p>}
          {!isLoading && error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {!isLoading && results.length > 0 && results.map((r, i) => {
            const fieldCount = countSeriesLookupFields(r)
            return (
              <button
                key={i}
                type="button"
                onClick={() => setPicked(r)}
                className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-white dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex gap-3 items-start">
                  {r.cover_url && (
                    <img src={r.cover_url} alt="" referrerPolicy="no-referrer" className="w-10 h-14 object-cover rounded flex-shrink-0 bg-gray-200 dark:bg-gray-700" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm text-gray-900 dark:text-white">{r.name}</p>
                      <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${fieldBadgeCls(fieldCount)}`}>
                        {fieldCount}/{TOTAL_SERIES_FIELDS} fields
                      </span>
                    </div>
                    {r.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{r.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {r.total_count != null && <span className="text-xs text-gray-400 dark:text-gray-500">{r.total_count} vols</span>}
                      {r.status && (
                        <span className={`text-xs rounded-full px-1.5 py-0.5 ${r.status === 'completed' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' : r.status === 'hiatus' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' : r.status === 'cancelled' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'}`}>
                          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                        </span>
                      )}
                      {r.demographic && <span className="text-xs text-gray-400 dark:text-gray-500">{r.demographic}</span>}
                      {r.original_language && <span className="text-xs text-gray-400 dark:text-gray-500">{r.original_language}</span>}
                      <span className="text-xs text-gray-400 dark:text-gray-500">via {r.provider_display}</span>
                    </div>
                    {r.genres && r.genres.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.genres.slice(0, 5).map(g => (
                          <span key={g} className="text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5">{g}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Series merge view (step 2 of metadata update) ────────────────────────────

interface SeriesMergeViewProps {
  series: Series
  libraryId: string
  primary: SeriesLookupResult
  matching: SeriesLookupResult[]
  onBack: () => void
  onClose: () => void
  onSaved: (updated: Series) => void
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'hiatus', label: 'Hiatus' },
  { value: 'cancelled', label: 'Cancelled' },
]

function SeriesMergeView({ series, libraryId, primary, matching, onBack, onClose, onSaved }: SeriesMergeViewProps) {
  const { callApi } = useAuth()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entries = <T,>(fn: (r: SeriesLookupResult) => T) =>
    matching.map(r => ({ source: r.provider_display, value: fn(r) }))

  const descOpts   = useMemo(() => sortOptions(mergeString(series.description, entries(r => r.description))), [series, matching])
  const totalOpts  = useMemo(() => sortOptions(mergeNumber(series.total_count, entries(r => r.total_count))), [series, matching])
  const statusOpts = useMemo(() => sortOptions(mergeString(series.status, entries(r => r.status))), [series, matching])
  const langOpts   = useMemo(() => sortOptions(mergeString(series.original_language, entries(r => r.original_language))), [series, matching])
  const yearOpts   = useMemo(() => sortOptions(mergeNumber(series.publication_year, entries(r => r.publication_year))), [series, matching])
  const demoOpts   = useMemo(() => sortOptions(mergeString(series.demographic, entries(r => r.demographic))), [series, matching])
  const genresOpts = useMemo(() => sortOptions(mergeGenres(series.genres, entries(r => r.genres ?? []))), [series, matching])

  const [desc, setDesc]     = useState<string>(descOpts[0]?.value ?? series.description ?? '')
  const [total, setTotal]   = useState<number | null>(totalOpts[0]?.value ?? series.total_count ?? null)
  const [status, setStatus] = useState<string>(statusOpts[0]?.value ?? series.status ?? 'ongoing')
  const [lang, setLang]     = useState<string>(langOpts[0]?.value ?? series.original_language ?? '')
  const [year, setYear]     = useState<number | null>(yearOpts[0]?.value ?? series.publication_year ?? null)
  const [demo, setDemo]     = useState<string>(demoOpts[0]?.value ?? series.demographic ?? '')
  const [genres, setGenres] = useState<string[]>(genresOpts[0]?.value ?? series.genres ?? [])
  // URL / external_id / external_source tied to primary pick.

  const save = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const body = {
        name: series.name,
        description: desc,
        total_count: total,
        status: status || 'ongoing',
        original_language: lang,
        publication_year: year,
        demographic: demo,
        genres,
        url: primary.url || series.url || '',
        external_id: primary.external_id || series.external_id || '',
        external_source: primary.external_source || series.external_source || '',
      }
      const updated = await callApi<Series>(
        `/api/v1/libraries/${libraryId}/series/${series.id}`,
        { method: 'PUT', body: JSON.stringify(body) },
      )
      if (updated) onSaved(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-16 px-4">
      <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-gray-900 shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <button type="button" onClick={onBack}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 mb-1">
              ← Back to results
            </button>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">Update metadata: {primary.name}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Merging {matching.length} provider{matching.length === 1 ? '' : 's'}: {matching.map(m => m.provider_display).join(', ')}.
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <FieldPicker label="Description" options={descOpts} selected={desc}
            equals={(a, b) => a === b} onPick={v => setDesc(v)}
            render={v => <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{v || <em className="text-gray-400">empty</em>}</p>} />

          <FieldPicker label="Total volumes" options={totalOpts} selected={total}
            equals={(a, b) => a === b} onPick={v => setTotal(v)}
            render={v => <span className="text-sm text-gray-800 dark:text-gray-200">{v == null ? <em className="text-gray-400">unset</em> : v}</span>} />

          <FieldPicker label="Status" options={statusOpts} selected={status}
            equals={(a, b) => a.toLowerCase() === b.toLowerCase()} onPick={v => setStatus(v)}
            render={v => <span className="text-sm capitalize text-gray-800 dark:text-gray-200">{v || <em className="text-gray-400">unset</em>}</span>}
            extraControl={
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="mt-2 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            } />

          <FieldPicker label="Original language" options={langOpts} selected={lang}
            equals={(a, b) => a.toLowerCase() === b.toLowerCase()} onPick={v => setLang(v)}
            render={v => <span className="text-sm text-gray-800 dark:text-gray-200">{v || <em className="text-gray-400">unset</em>}</span>} />

          <FieldPicker label="Publication year" options={yearOpts} selected={year}
            equals={(a, b) => a === b} onPick={v => setYear(v)}
            render={v => <span className="text-sm text-gray-800 dark:text-gray-200">{v == null ? <em className="text-gray-400">unset</em> : v}</span>} />

          <FieldPicker label="Demographic" options={demoOpts} selected={demo}
            equals={(a, b) => a.toLowerCase() === b.toLowerCase()} onPick={v => setDemo(v)}
            render={v => <span className="text-sm text-gray-800 dark:text-gray-200">{v || <em className="text-gray-400">unset</em>}</span>} />

          <FieldPicker label="Genres" options={genresOpts} selected={genres}
            equals={(a, b) => a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase())}
            onPick={v => setGenres(v)}
            render={v => v.length === 0
              ? <em className="text-sm text-gray-400">none</em>
              : (
                <div className="flex flex-wrap gap-1">
                  {v.map(g => <span key={g} className="text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5">{g}</span>)}
                </div>
              )} />

          <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
            Source link &amp; URL: <span className="font-medium text-gray-700 dark:text-gray-300">{primary.provider_display}</span>
            {primary.url && <> — <a href={primary.url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline break-all">{primary.url}</a></>}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="ml-auto flex gap-3">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={isSaving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface FieldPickerProps<T> {
  label: string
  options: SeriesFieldOption<T>[]
  selected: T
  equals: (a: T, b: T) => boolean
  onPick: (v: T) => void
  render: (v: T) => React.ReactNode
  extraControl?: React.ReactNode
}

function FieldPicker<T>({ label, options, selected, equals, onPick, render, extraControl }: FieldPickerProps<T>) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">{label}</p>
      {options.length === 0 && (
        <p className="text-sm italic text-gray-400 dark:text-gray-500">No values from providers or current record.</p>
      )}
      <div className="space-y-1.5">
        {options.map((opt, i) => {
          const isSelected = equals(selected, opt.value)
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(opt.value)}
              className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">{render(opt.value)}</div>
                <div className="flex flex-wrap gap-1 flex-shrink-0">
                  {opt.sources.map(s => (
                    <span key={s} className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ${
                      s === 'Current'
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                        : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
                    }`}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      {extraControl}
    </div>
  )
}

interface SeriesDetailViewProps {
  seriesId: string
  libraryId: string
  setExtraCrumbs: (cs: Crumb[]) => void
  onBack: () => void
}

// ─── Series volume cover ─────────────────────────────────────────────────────
// Larger than BookCoverThumb, with the volume number embedded as a corner
// badge so the # column can go away. Read-state glow follows the same color
// scheme used by BookCoverThumb so both surfaces are consistent.
function SeriesVolumeCover({
  title, coverUrl, position, readStatus, isGhost,
}: {
  title: string
  coverUrl: string | null | undefined
  position: number
  readStatus?: string
  isGhost?: boolean
}) {
  const [imgError, setImgError] = useState(false)
  const src = useAuthenticatedImage(coverUrl)
  const showImage = !!src && !imgError && !isGhost

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const border = isDark ? '0 0 0 1px rgba(255,255,255,0.15)' : '0 0 0 1px rgba(0,0,0,0.2)'
  const glow: React.CSSProperties = (() => {
    if (isGhost) return { boxShadow: border }
    if (readStatus === 'read')           return { boxShadow: `${border}, 0 0 12px 3px rgba(34,197,94,0.7)` }
    if (readStatus === 'reading')        return { boxShadow: `${border}, 0 0 12px 3px rgba(59,130,246,0.7)` }
    if (readStatus === 'did_not_finish') return { boxShadow: `${border}, 0 0 12px 3px rgba(245,158,11,0.7)` }
    return { boxShadow: border }
  })()

  // The first letter is used as a placeholder when no cover; harmless for
  // ghost rows since they always render the gradient.
  const grad = COVER_GRADIENTS[title.charCodeAt(0) % COVER_GRADIENTS.length]

  return (
    <div className={`w-12 flex-shrink-0 rounded ${isGhost ? 'opacity-50' : ''}`} style={glow}>
      <div className="relative aspect-[2/3] rounded overflow-hidden">
        {showImage ? (
          <img src={src} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${grad} flex items-center justify-center`}>
            <span className="text-white text-base font-bold opacity-50 select-none">{title.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <span className="absolute bottom-0 right-0 bg-black/75 text-white text-[10px] font-bold leading-none px-1.5 py-0.5 rounded-tl">
          {formatPosition(position)}
        </span>
      </div>
    </div>
  )
}

// Subset of COVER_GRADIENTS from BookCover — kept inline so we don't need to
// export the array from there.
const COVER_GRADIENTS = [
  'from-rose-500 to-orange-400',
  'from-blue-500 to-cyan-400',
  'from-emerald-500 to-lime-400',
  'from-violet-500 to-fuchsia-400',
  'from-amber-500 to-red-400',
  'from-teal-500 to-blue-400',
]

// ─── AI proposal review panel ────────────────────────────────────────────────
// Pending AI suggestions render at the top of the series detail view. The user
// reviews each proposal, accepts a subset of fields/arcs (or all), or rejects.
// On accept, the API writes the chosen subset to the series and creates arcs.

interface ProposalsPanelProps {
  proposals: AIMetadataProposal[]
  existingArcCount: number
  onAccept: (proposalID: string, body?: Record<string, unknown>) => void
  onReject: (proposalID: string) => void
}

function ProposalsPanel({ proposals, existingArcCount, onAccept, onReject }: ProposalsPanelProps) {
  if (proposals.length === 0) return null
  return (
    <div className="mb-4 space-y-3">
      {proposals.map(p => p.kind === 'series_metadata' ? (
        <SeriesMetadataProposalCard key={p.id} proposal={p} onAccept={onAccept} onReject={onReject} />
      ) : (
        <SeriesArcsProposalCard key={p.id} proposal={p} existingArcCount={existingArcCount} onAccept={onAccept} onReject={onReject} />
      ))}
    </div>
  )
}

function SeriesMetadataProposalCard({ proposal, onAccept, onReject }: { proposal: AIMetadataProposal; onAccept: (id: string, body?: Record<string, unknown>) => void; onReject: (id: string) => void }) {
  const payload = proposal.payload as SeriesMetadataPayload
  const fields: { key: string; label: string; value: string | null }[] = [
    { key: 'status', label: 'Status', value: payload.status ?? null },
    { key: 'total_count', label: 'Total volumes', value: payload.total_count != null ? String(payload.total_count) : null },
    { key: 'demographic', label: 'Demographic', value: payload.demographic ?? null },
    { key: 'genres', label: 'Genres', value: payload.genres && payload.genres.length > 0 ? payload.genres.join(', ') : null },
    { key: 'description', label: 'Description', value: payload.description ?? null },
  ].filter(f => f.value !== null)

  const [selected, setSelected] = useState<Set<string>>(new Set(fields.map(f => f.key)))
  const toggle = (k: string) => setSelected(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const apply = () => {
    if (selected.size === 0) return
    const allSelected = selected.size === fields.length
    onAccept(proposal.id, allSelected ? undefined : { fields: Array.from(selected) })
  }

  if (fields.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
        <div className="flex items-center justify-between">
          <p className="text-amber-800 dark:text-amber-300">AI didn't have evidence for any series-level fields.</p>
          <button onClick={() => onReject(proposal.id)} className="text-xs text-amber-700 dark:text-amber-400 hover:underline">Dismiss</button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-purple-900 dark:text-purple-200">AI suggestion: series fields</p>
          <p className="text-xs text-purple-700/80 dark:text-purple-300/70">Review and pick which fields to apply.</p>
        </div>
        <button onClick={() => onReject(proposal.id)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400">Dismiss</button>
      </div>
      <ul className="space-y-1.5 mb-3">
        {fields.map(f => (
          <li key={f.key}>
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={selected.has(f.key)} onChange={() => toggle(f.key)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600" />
              <span className="text-sm text-gray-800 dark:text-gray-200 flex-1">
                <span className="font-medium">{f.label}:</span>{' '}
                <span className="text-gray-600 dark:text-gray-400">{f.value}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 justify-end">
        <button onClick={() => onReject(proposal.id)}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
          Reject all
        </button>
        <button onClick={apply} disabled={selected.size === 0}
          className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
          Apply selected
        </button>
      </div>
    </div>
  )
}

function SeriesArcsProposalCard({ proposal, existingArcCount, onAccept, onReject }: { proposal: AIMetadataProposal; existingArcCount: number; onAccept: (id: string, body?: Record<string, unknown>) => void; onReject: (id: string) => void }) {
  const payload = proposal.payload as SeriesArcsPayload
  const [selected, setSelected] = useState<Set<number>>(new Set(payload.arcs?.map((_, i) => i) ?? []))
  const [assignBooks, setAssignBooks] = useState(true)

  if (!payload.arcs || payload.arcs.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
        <div className="flex items-center justify-between">
          <p className="text-amber-800 dark:text-amber-300">AI didn't propose any canonical arcs for this series.</p>
          <button onClick={() => onReject(proposal.id)} className="text-xs text-amber-700 dark:text-amber-400 hover:underline">Dismiss</button>
        </div>
      </div>
    )
  }

  const toggle = (i: number) => setSelected(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n })

  const apply = () => {
    if (selected.size === 0) return
    if (existingArcCount > 0) {
      const msg = `This will delete the ${existingArcCount} existing arc${existingArcCount === 1 ? '' : 's'} on this series and replace ${existingArcCount === 1 ? 'it' : 'them'} with ${selected.size} new arc${selected.size === 1 ? '' : 's'}. Books will be re-grouped by the new volume ranges. Continue?`
      if (!confirm(msg)) return
    }
    const all = selected.size === payload.arcs.length
    const body: Record<string, unknown> = { assign_books: assignBooks }
    if (!all) body.arc_indices = Array.from(selected).sort((a, b) => a - b)
    onAccept(proposal.id, body)
  }

  const isReplace = existingArcCount > 0

  return (
    <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-purple-900 dark:text-purple-200">AI suggestion: arcs</p>
          <p className="text-xs text-purple-700/80 dark:text-purple-300/70">
            {isReplace
              ? `Accepting will replace the ${existingArcCount} existing arc${existingArcCount === 1 ? '' : 's'} on this series.`
              : 'Pick which arcs to create.'}
          </p>
        </div>
        <button onClick={() => onReject(proposal.id)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400">Dismiss</button>
      </div>
      <ul className="space-y-1.5 mb-3">
        {payload.arcs.map((arc, i) => {
          const range = arc.vol_start != null && arc.vol_end != null ? `vols ${arc.vol_start}–${arc.vol_end}` : 'no range'
          return (
            <li key={i}>
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600" />
                <span className="text-sm text-gray-800 dark:text-gray-200 flex-1">
                  <span className="font-medium">{arc.name}</span>
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{range}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <label className="flex items-center gap-2.5 mb-3 cursor-pointer select-none">
        <input type="checkbox" checked={assignBooks} onChange={e => setAssignBooks(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600" />
        <span className="text-xs text-gray-700 dark:text-gray-300">Auto-assign books in suggested ranges to their arcs</span>
      </label>
      <div className="flex gap-2 justify-end">
        <button onClick={() => onReject(proposal.id)}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
          Reject all
        </button>
        <button onClick={apply} disabled={selected.size === 0}
          className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
          {isReplace ? 'Replace arcs' : 'Create selected arcs'}
        </button>
      </div>
    </div>
  )
}

// ─── Arc management ──────────────────────────────────────────────────────────

interface ArcManagerPanelProps {
  libraryId: string
  seriesId: string
  arcs: SeriesArc[]
  open: boolean
  onToggle: () => void
  onChanged: () => void
  onSuggestArcs?: () => void
  isSuggesting?: boolean
}

function ArcManagerPanel({ libraryId, seriesId, arcs, open, onToggle, onChanged, onSuggestArcs, isSuggesting }: ArcManagerPanelProps) {
  const { callApi } = useAuth()
  const [editingArc, setEditingArc] = useState<SeriesArc | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const sorted = [...arcs].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

  return (
    <div className="mb-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors rounded-t-xl">
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-sm text-gray-900 dark:text-white">Arcs</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{arcs.length === 0 ? 'none yet' : `${arcs.length} arc${arcs.length !== 1 ? 's' : ''}`}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-800 p-4 space-y-3">
          {sorted.length > 0 && (
            <ul className="space-y-1.5">
              {sorted.map(arc => editingArc?.id === arc.id ? (
                <ArcEditRow
                  key={arc.id}
                  libraryId={libraryId}
                  seriesId={seriesId}
                  arc={arc}
                  onCancel={() => setEditingArc(null)}
                  onSaved={() => { setEditingArc(null); onChanged() }}
                />
              ) : (
                <li key={arc.id} className="flex items-center gap-3 text-sm">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300 flex-shrink-0">
                    {formatPosition(arc.position)}
                  </span>
                  <span className="flex-1 font-medium text-gray-900 dark:text-white">{arc.name}</span>
                  {arc.vol_start != null && arc.vol_end != null && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      vols {formatPosition(arc.vol_start)}–{formatPosition(arc.vol_end)}
                    </span>
                  )}
                  <span className="text-xs text-gray-400 dark:text-gray-500">{arc.book_count} book{arc.book_count !== 1 ? 's' : ''}</span>
                  <button onClick={() => setEditingArc(arc)}
                    className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="Edit arc">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                  <button onClick={async () => {
                      if (!confirm(`Delete arc "${arc.name}"? Books in it will stay in the series, just unassigned.`)) return
                      await callApi(`/api/v1/libraries/${libraryId}/series/${seriesId}/arcs/${arc.id}`, { method: 'DELETE' }).catch(() => {})
                      onChanged()
                    }}
                    className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="Delete arc">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {showAddForm ? (
            <ArcEditRow
              libraryId={libraryId}
              seriesId={seriesId}
              arc={null}
              defaultPosition={sorted.length + 1}
              onCancel={() => setShowAddForm(false)}
              onSaved={() => { setShowAddForm(false); onChanged() }}
            />
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => setShowAddForm(true)}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline">+ Add arc</button>
              {onSuggestArcs && (
                <button onClick={onSuggestArcs} disabled={isSuggesting}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50">
                  {isSuggesting ? 'Asking AI…' : (sorted.length > 0 ? 'Re-suggest with AI' : 'Suggest with AI')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface ArcEditRowProps {
  libraryId: string
  seriesId: string
  arc: SeriesArc | null
  defaultPosition?: number
  onCancel: () => void
  onSaved: () => void
}

function ArcEditRow({ libraryId, seriesId, arc, defaultPosition, onCancel, onSaved }: ArcEditRowProps) {
  const { callApi } = useAuth()
  const [name, setName] = useState(arc?.name ?? '')
  const [position, setPosition] = useState(String(arc?.position ?? defaultPosition ?? 1))
  const [description, setDescription] = useState(arc?.description ?? '')
  // Vol bounds are optional. Empty input string ⇒ null in the request body
  // so existing bounds can be cleared. Stored as strings while editing so a
  // partially-typed number doesn't get coerced to NaN mid-keystroke.
  const [volStart, setVolStart] = useState(arc?.vol_start != null ? String(arc.vol_start) : '')
  const [volEnd, setVolEnd] = useState(arc?.vol_end != null ? String(arc.vol_end) : '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    const parseBound = (s: string): number | null => {
      const t = s.trim()
      if (t === '') return null
      const n = Number(t)
      return Number.isFinite(n) ? n : null
    }
    const body = JSON.stringify({
      name: name.trim(),
      position: Number(position) || 0,
      description,
      vol_start: parseBound(volStart),
      vol_end: parseBound(volEnd),
    })
    const url = arc
      ? `/api/v1/libraries/${libraryId}/series/${seriesId}/arcs/${arc.id}`
      : `/api/v1/libraries/${libraryId}/series/${seriesId}/arcs`
    const method = arc ? 'PUT' : 'POST'
    try {
      await callApi(url, { method, headers: { 'Content-Type': 'application/json' }, body })
      onSaved()
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input type="number" step="any" value={position} onChange={e => setPosition(e.target.value)}
          className="w-16 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-white px-2 py-1 text-sm"
          placeholder="Pos" />
        <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus
          className="flex-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-white px-2 py-1 text-sm"
          placeholder="Arc name" />
      </div>
      <input type="text" value={description} onChange={e => setDescription(e.target.value)}
        className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-white px-2 py-1 text-sm"
        placeholder="Description (optional)" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 w-20">Vol range</span>
        <input type="number" step="any" value={volStart} onChange={e => setVolStart(e.target.value)}
          className="w-20 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-white px-2 py-1 text-sm"
          placeholder="Start" />
        <span className="text-xs text-gray-400">–</span>
        <input type="number" step="any" value={volEnd} onChange={e => setVolEnd(e.target.value)}
          className="w-20 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-white px-2 py-1 text-sm"
          placeholder="End" />
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
          Optional. Slots missing volumes into this arc when set.
        </span>
      </div>
      <div className="flex items-center gap-2 justify-end">
        <button onClick={onCancel} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Cancel</button>
        <button onClick={save} disabled={saving || !name.trim()}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : (arc ? 'Save' : 'Add')}
        </button>
      </div>
    </div>
  )
}

interface BookArcAssignerProps {
  entry: SeriesEntry
  arcs: SeriesArc[]
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  onAssign: (arcID: string | null) => void
}

function BookArcAssigner({ entry, arcs, isOpen, onOpen, onClose, onAssign }: BookArcAssignerProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, onClose])

  const currentArc = arcs.find(a => a.id === entry.arc_id)
  const sorted = [...arcs].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

  return (
    <div ref={ref} className="relative">
      <button onClick={isOpen ? onClose : onOpen}
        className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 transition-colors">
        {currentArc ? `Arc: ${currentArc.name}` : 'Set arc'}
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1">
          <button onClick={() => onAssign(null)}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${!entry.arc_id ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
            Unsorted
          </button>
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          {sorted.map(arc => (
            <button key={arc.id} onClick={() => onAssign(arc.id)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${entry.arc_id === arc.id ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              {arc.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SeriesDetailView({ seriesId, libraryId, setExtraCrumbs, onBack }: SeriesDetailViewProps) {
  const { callApi } = useAuth()
  const { show: showToast } = useToast()
  // Series is fetched on mount so the URL is the source of truth — users can
  // share links straight to a series without going through the list first.
  const [series, setSeries] = useState<Series | null>(null)
  const [entries, setEntries] = useState<SeriesEntry[]>([])
  const [volumes, setVolumes] = useState<SeriesVolume[]>([])
  const [arcs, setArcs] = useState<SeriesArc[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addHint, setAddHint] = useState<{ position?: number; query?: string } | null>(null)
  const [editEntry, setEditEntry] = useState<SeriesEntry | null>(null)
  const [showArcManager, setShowArcManager] = useState(false)
  const [assigningBookId, setAssigningBookId] = useState<string | null>(null)
  const [showMetaSearch, setShowMetaSearch] = useState(false)
  const [showAutoMatch, setShowAutoMatch] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [proposals, setProposals] = useState<AIMetadataProposal[]>([])
  const [isSuggestingMetadata, setIsSuggestingMetadata] = useState(false)
  const [isSuggestingArcs, setIsSuggestingArcs] = useState(false)

  const deleteSeries = async () => {
    if (!series) return
    if (!confirm(`Delete series "${series.name}"?`)) return
    try {
      await callApi(`/api/v1/libraries/${libraryId}/series/${seriesId}`, { method: 'DELETE' })
      onBack()
    } catch { /* ignore */ }
  }

  const reloadSeries = useCallback(async () => {
    try {
      const updated = await callApi<Series>(`/api/v1/libraries/${libraryId}/series/${seriesId}`)
      if (updated) setSeries(updated)
    } catch { /* ignore */ }
  }, [callApi, libraryId, seriesId])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [list, vols, arcList, props] = await Promise.all([
        callApi<SeriesEntry[]>(`/api/v1/libraries/${libraryId}/series/${seriesId}/books`),
        callApi<SeriesVolume[]>(`/api/v1/libraries/${libraryId}/series/${seriesId}/volumes`),
        callApi<SeriesArc[]>(`/api/v1/libraries/${libraryId}/series/${seriesId}/arcs`),
        callApi<AIMetadataProposal[]>(`/api/v1/libraries/${libraryId}/series/${seriesId}/proposals?status=pending`),
      ])
      setEntries(list ?? [])
      setVolumes(vols ?? [])
      setArcs(arcList ?? [])
      setProposals(props ?? [])
    } catch { /* ignore */ }
    finally { setIsLoading(false) }
  }, [callApi, libraryId, seriesId])

  const suggestSeriesMetadata = async () => {
    if (isSuggestingMetadata) return
    setIsSuggestingMetadata(true)
    try {
      await callApi(`/api/v1/libraries/${libraryId}/series/${seriesId}/suggest-metadata`, { method: 'POST' })
      await load()
      showToast('AI suggestion ready — review below.', { variant: 'success' })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to call AI provider'
      showToast(`AI suggestion failed: ${msg}`, { variant: 'error' })
    } finally {
      setIsSuggestingMetadata(false)
    }
  }

  const suggestSeriesArcs = async () => {
    if (isSuggestingArcs) return
    setIsSuggestingArcs(true)
    try {
      await callApi(`/api/v1/libraries/${libraryId}/series/${seriesId}/suggest-arcs`, { method: 'POST' })
      await load()
      showToast('AI arc suggestion ready — review below.', { variant: 'success' })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to call AI provider'
      showToast(`AI arc suggestion failed: ${msg}`, { variant: 'error' })
    } finally {
      setIsSuggestingArcs(false)
    }
  }

  const acceptProposal = async (proposalID: string, body?: Record<string, unknown>) => {
    await callApi(`/api/v1/libraries/${libraryId}/proposals/${proposalID}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(err => console.error('accept proposal failed', err))
    await Promise.all([load(), reloadSeries()])
  }

  const rejectProposal = async (proposalID: string) => {
    await callApi(`/api/v1/libraries/${libraryId}/proposals/${proposalID}/reject`, { method: 'POST' }).catch(() => {})
    await load()
  }

  // URL is the source of truth — fetch the series on mount or when the id
  // changes. Direct hits to /libraries/{lib}/series/{sid} land here too.
  useEffect(() => { reloadSeries() }, [reloadSeries])

  // Once we know the series name, push a "Series › <name>" breadcrumb so the
  // header reflects where we are.
  useEffect(() => {
    if (series) {
      setExtraCrumbs([{ label: 'Series', to: `/libraries/${libraryId}/series` }, { label: series.name }])
    }
  }, [series, libraryId, setExtraCrumbs])

  const assignBookToArc = async (bookId: string, position: number, arcID: string | null) => {
    // Empty string clears an existing arc; UUID assigns; null/undefined leaves it.
    await callApi(`/api/v1/libraries/${libraryId}/series/${seriesId}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id: bookId, position, arc_id: arcID ?? '' }),
    }).catch(() => {})
    setAssigningBookId(null)
    load()
  }

  const syncVolumes = async () => {
    if (!series?.external_id) return
    setIsSyncing(true)
    try {
      const vols = await callApi<SeriesVolume[]>(
        `/api/v1/libraries/${libraryId}/series/${seriesId}/volumes/sync`,
        { method: 'POST' }
      )
      setVolumes(vols ?? [])
    } catch { /* ignore */ } finally {
      setIsSyncing(false)
    }
  }

  useEffect(() => { load() }, [load])

  const removeEntry = async (bookId: string) => {
    if (!confirm('Remove this book from the series?')) return
    await callApi(`/api/v1/libraries/${libraryId}/series/${seriesId}/books/${bookId}`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  // Show a loading state until the series is fetched. The rest of the body
  // can safely assume series is non-null.
  if (!series) {
    return <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-16">Loading…</div>
  }

  // Build merged list: real entries + ghost rows for missing integer positions.
  // Upper bound is whichever is larger: highest entry/volume position we have, or total_count.
  const existingPositions = new Set(entries.map(e => e.position))
  const volumeByPosition = new Map(volumes.map(v => [v.position, v]))
  const maxEntryPos = entries.length > 0 ? Math.max(...entries.map(e => e.position)) : 0
  const maxVolumePos = volumes.length > 0 ? Math.max(...volumes.map(v => v.position)) : 0
  const upperBound = Math.max(Math.floor(maxEntryPos), Math.floor(maxVolumePos), series.total_count ?? 0)

  type Row = { type: 'entry'; entry: SeriesEntry } | { type: 'ghost'; position: number; volume?: SeriesVolume }

  // When arcs exist we group books under arc-header rows instead of one flat
  // list. Books without an arc cluster under "Unsorted"; missing volumes go to
  // a "Missing volumes" footer group.
  type Group = { key: string; label: string; arcId: string | null; rows: Row[] }
  // No initializer: both branches of the arcs check below assign it.
  let groups: Group[]

  if (arcs.length > 0) {
    // Infer which arc a missing volume sits in. Two-tier strategy:
    //
    //   1. If any arc has explicit vol_start/vol_end bounds covering this
    //      position, use that arc. AI proposals carry these bounds, so the
    //      Final Saga (vols 110–148) properly claims a ghost vol 113 even
    //      when zero books in that arc are owned.
    //   2. Otherwise fall back to immediate neighbours: a ghost between two
    //      owned books in the SAME arc inherits that arc. Anything else
    //      (mixed arcs, one or both unsorted) leaves the ghost unsorted, to
    //      be caught by the "Missing volumes" group.
    const allOwned: Array<{ pos: number; arcID: string | null }> = entries
      .map(e => ({ pos: e.position, arcID: e.arc_id ?? null }))
      .sort((a, b) => a.pos - b.pos)

    const inferArcForPos = (p: number): string | null => {
      // Tier 1 — explicit bounds. Use the most-specific arc when ranges
      // overlap (smaller span wins on ties).
      let bestArcID: string | null = null
      let bestSpan = Infinity
      for (const arc of arcs) {
        if (arc.vol_start == null || arc.vol_end == null) continue
        if (p < arc.vol_start || p > arc.vol_end) continue
        const span = arc.vol_end - arc.vol_start
        if (span < bestSpan) {
          bestSpan = span
          bestArcID = arc.id
        }
      }
      if (bestArcID) return bestArcID

      // Tier 2 — immediate-neighbour inference for arcs without bounds.
      let prev: { pos: number; arcID: string | null } | null = null
      let next: { pos: number; arcID: string | null } | null = null
      for (const o of allOwned) {
        if (o.pos < p) prev = o
        else if (o.pos > p && next === null) { next = o; break }
      }
      if (prev && next && prev.arcID && next.arcID && prev.arcID === next.arcID) {
        return prev.arcID
      }
      return null
    }

    // Bucket entries + ghosts together by (inferred) arc_id. Each bucket
    // ends up containing both real entries and any greyed-out gaps that fall
    // within its position range, sorted naturally by position.
    type RowsByKey = Map<string | null, Row[]>
    const rowsByKey: RowsByKey = new Map()
    const push = (k: string | null, r: Row) => {
      if (!rowsByKey.has(k)) rowsByKey.set(k, [])
      rowsByKey.get(k)!.push(r)
    }
    for (const e of entries) push(e.arc_id ?? null, { type: 'entry', entry: e })
    for (let i = 1; i <= upperBound; i++) {
      if (existingPositions.has(i)) continue
      const arcID = inferArcForPos(i)
      push(arcID, { type: 'ghost', position: i, volume: volumeByPosition.get(i) })
    }
    const rowPos = (r: Row) => r.type === 'entry' ? r.entry.position : r.position
    for (const rs of rowsByKey.values()) rs.sort((a, b) => rowPos(a) - rowPos(b))

    // Build all groups (arcs + unsorted + truly-orphan missing) and sort by
    // their first row's position so reading order flows top-to-bottom.
    const collected: Array<Group & { sortKey: number }> = []
    for (const arc of arcs) {
      const rs = rowsByKey.get(arc.id) ?? []
      if (rs.length === 0) continue // arc with no books and no inferable gaps
      collected.push({
        key: arc.id, label: arc.name, arcId: arc.id,
        rows: rs,
        sortKey: rowPos(rs[0]),
      })
    }
    const unsortedRows = rowsByKey.get(null) ?? []
    if (unsortedRows.length > 0) {
      // Split: real entries in "Unsorted", orphan ghosts in "Missing volumes".
      const unsortedEntries = unsortedRows.filter(r => r.type === 'entry')
      const orphanGhosts = unsortedRows.filter(r => r.type === 'ghost')
      if (unsortedEntries.length > 0) {
        collected.push({
          key: 'unsorted', label: 'Unsorted', arcId: null,
          rows: unsortedEntries,
          sortKey: rowPos(unsortedEntries[0]),
        })
      }
      if (orphanGhosts.length > 0) {
        collected.push({
          key: 'missing', label: 'Missing volumes', arcId: null,
          rows: orphanGhosts,
          sortKey: rowPos(orphanGhosts[0]),
        })
      }
    }
    collected.sort((a, b) => a.sortKey - b.sortKey)
    groups = collected.map(({ key, label, arcId, rows }) => ({ key, label, arcId, rows }))
  } else {
    // Flat — single group with entries + ghosts interleaved by position.
    const allRows: Row[] = [...entries.map(e => ({ type: 'entry' as const, entry: e }))]
    for (let i = 1; i <= upperBound; i++) {
      if (!existingPositions.has(i)) allRows.push({ type: 'ghost', position: i, volume: volumeByPosition.get(i) })
    }
    allRows.sort((a, b) => {
      const posA = a.type === 'entry' ? a.entry.position : a.position
      const posB = b.type === 'entry' ? b.entry.position : b.position
      return posA - posB
    })
    groups = [{ key: 'flat', label: '', arcId: null, rows: allRows }]
  }

  const hasAnyRows = groups.some(g => g.rows.length > 0)
  const COL_COUNT = 5 // cover (with embedded #), title, type, contributors, actions
  const showReadBadges = localStorage.getItem('librarium:show_read_badges') !== 'false'

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={onBack} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">← Back</button>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {seriesStatusLabel(series.status)}
          {series.total_count != null && ` · ${series.book_count} / ${series.total_count} volumes`}
        </span>
        <div className="flex-1" />
        {series.external_id && (
          <button onClick={syncVolumes} disabled={isSyncing}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors">
            {isSyncing ? 'Syncing…' : 'Sync volumes'}
          </button>
        )}
        <button onClick={() => setShowAutoMatch(true)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          Auto-match
        </button>
        <button onClick={() => setShowMetaSearch(true)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          Search metadata
        </button>
        <button onClick={suggestSeriesMetadata} disabled={isSuggestingMetadata}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          title="Ask AI to suggest series fields (status, total volumes, demographic, genres, description)">
          {isSuggestingMetadata ? 'Asking AI…' : 'Suggest with AI'}
        </button>
        <button onClick={() => setShowEdit(true)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          Edit series
        </button>
        <button onClick={deleteSeries}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-700 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-800 transition-colors">
          Delete series
        </button>
        {/* Exports the volumes you own from this series, ordered by position. */}
        <ExportButton
          urlFor={format => booksExportUrl(libraryId, format, { seriesId: series.id })}
          fallbackName={`series-${series.name}`}
          label="Export"
          disabled={!hasAnyRows}
        />
        <button onClick={() => setShowAdd(true)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
          Add book
        </button>
      </div>

      {(series.description || series.url) && (
        <div className="mb-4 space-y-1">
          {series.description && <p className="text-sm text-gray-500 dark:text-gray-400">{series.description}</p>}
          {series.url && (
            <a href={series.url} target="_blank" rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
              {series.url}
            </a>
          )}
        </div>
      )}

      {isLoading && <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-16">Loading…</div>}

      {!isLoading && !hasAnyRows && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No books in this series yet</p>
          <button onClick={() => setShowAdd(true)} className="text-sm text-blue-600 hover:underline">Add the first book</button>
        </div>
      )}

      {/* AI suggestion review panel — surfaces pending proposals so the user
          can accept/reject before the API writes anything. */}
      <ProposalsPanel proposals={proposals} existingArcCount={arcs.length} onAccept={acceptProposal} onReject={rejectProposal} />

      {/* Arc management panel — collapsed by default. Always available so users
          can add the first arc to a series. */}
      <ArcManagerPanel
        libraryId={libraryId}
        seriesId={seriesId}
        arcs={arcs}
        open={showArcManager}
        onToggle={() => setShowArcManager(o => !o)}
        onChanged={load}
        onSuggestArcs={suggestSeriesArcs}
        isSuggesting={isSuggestingArcs}
      />

      {!isLoading && hasAnyRows && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                {['', 'Title', 'Type', 'Contributors', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {groups.map(group => (
                <Fragment key={group.key}>
                  {arcs.length > 0 && group.label && (
                    <tr className="bg-gray-50/60 dark:bg-gray-800/40">
                      <td colSpan={COL_COUNT} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{group.label}</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">· {group.rows.filter(r => r.type === 'entry').length} book{group.rows.filter(r => r.type === 'entry').length !== 1 ? 's' : ''}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {group.rows.map((row, idx) => row.type === 'entry' ? (
                    <tr key={row.entry.book_id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <td className="pl-4 pr-2 py-3 w-16">
                        <SeriesVolumeCover
                          title={row.entry.title}
                          coverUrl={row.entry.cover_url}
                          position={row.entry.position}
                          readStatus={showReadBadges ? row.entry.user_read_status : undefined}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/libraries/${libraryId}/books/${row.entry.book_id}`}
                          className="font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                          {row.entry.title}
                        </Link>
                        {row.entry.subtitle && <p className="text-xs text-gray-400 dark:text-gray-500">{row.entry.subtitle}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {row.entry.media_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
                        {row.entry.contributors.length > 0
                          ? row.entry.contributors.map(c => c.name).join(', ')
                          : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 justify-end">
                          {arcs.length > 0 && (
                            <BookArcAssigner
                              entry={row.entry}
                              arcs={arcs}
                              isOpen={assigningBookId === row.entry.book_id}
                              onOpen={() => setAssigningBookId(row.entry.book_id)}
                              onClose={() => setAssigningBookId(null)}
                              onAssign={arcID => assignBookToArc(row.entry.book_id, row.entry.position, arcID)}
                            />
                          )}
                          <button onClick={() => setEditEntry(row.entry)}
                            className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            title="Edit volume position">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button onClick={() => removeEntry(row.entry.book_id)}
                            className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            title="Remove from series">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={`ghost-${row.position}-${idx}`}>
                      <td className="pl-4 pr-2 py-3 w-16">
                        <SeriesVolumeCover
                          title={row.volume?.title || `Vol. ${row.position}`}
                          coverUrl={row.volume?.cover_url || null}
                          position={row.position}
                          isGhost
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="italic text-gray-400 dark:text-gray-500">
                          {row.volume?.title || `Vol. ${row.position}`}
                        </p>
                        {row.volume?.release_date && (
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            {new Date(row.volume.release_date + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 justify-end">
                          <button onClick={() => {
                              setAddHint({ position: row.position, query: series.name })
                              setShowAdd(true)
                            }}
                            className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 transition-colors">Add</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddToSeriesModal
          libraryId={libraryId}
          seriesId={series.id}
          existingBookIds={entries.map(e => e.book_id)}
          initialPosition={addHint?.position}
          initialQuery={addHint?.query}
          onClose={() => { setShowAdd(false); setAddHint(null) }}
          onSaved={() => { setShowAdd(false); setAddHint(null); load() }}
        />
      )}
      {editEntry && (
        <AddToSeriesModal
          libraryId={libraryId}
          seriesId={series.id}
          existingBookIds={entries.map(e => e.book_id)}
          editEntry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={() => { setEditEntry(null); load() }}
        />
      )}
      {showMetaSearch && (
        <SeriesMetadataSearchModal
          series={series}
          libraryId={libraryId}
          onClose={() => setShowMetaSearch(false)}
          onSaved={updated => { setSeries(updated); setShowMetaSearch(false) }}
        />
      )}
      {showAutoMatch && (
        <AutoMatchModal
          series={series}
          libraryId={libraryId}
          onClose={() => setShowAutoMatch(false)}
          onApplied={() => { setShowAutoMatch(false); load() }}
        />
      )}
      {showEdit && (
        <SeriesFormModal
          libraryId={libraryId}
          series={series}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); reloadSeries() }}
        />
      )}
    </div>
  )
}

interface SeriesTabProps {
  libraryId: string
  setExtraCrumbs: (crumbs: Crumb[]) => void
}

// Publication status as a plain word in the same metadata register as the
// count text — sits inline with "X owned" so the two pieces of secondary info
// don't compete for attention. Reading state stays as the only colored pill.
function seriesStatusLabel(status: string): string {
  if (status === 'completed') return 'Complete'
  if (status === 'hiatus') return 'On hiatus'
  if (status === 'cancelled') return 'Cancelled'
  return 'Ongoing'
}

// 2×2 collage of the first four volume covers — auto-derived; no manual
// "series cover" upload yet. Falls back to a gradient placeholder per tile.
function SeriesMosaic({ series, size = 'md' }: { series: Series; size?: 'sm' | 'md' | 'lg' }) {
  const tiles = series.preview_books.slice(0, 4)
  // Pad to 4 tiles with placeholders so the grid stays consistent
  const padded = [...tiles, ...Array(Math.max(0, 4 - tiles.length)).fill(null)] as (typeof tiles[0] | null)[]
  const containerCls = size === 'sm' ? 'w-16' : size === 'lg' ? 'w-40' : 'w-28'
  return (
    <div className={`${containerCls} aspect-square rounded-lg overflow-hidden grid grid-cols-2 grid-rows-2 gap-0.5 bg-gray-200 dark:bg-gray-800 shadow-md`}>
      {padded.map((p, i) => (
        <div key={i} className="relative overflow-hidden bg-gray-100 dark:bg-gray-900">
          {p ? <SeriesMosaicTile p={p} fallbackTitle={series.name} /> : <SeriesMosaicGradient title={series.name} idx={i} />}
        </div>
      ))}
    </div>
  )
}

function SeriesMosaicTile({ p, fallbackTitle }: { p: SeriesPreviewBook; fallbackTitle: string }) {
  const [imgError, setImgError] = useState(false)
  const src = useAuthenticatedImage(p.cover_url)
  if (!src || imgError) return <SeriesMosaicGradient title={p.title || fallbackTitle} idx={0} />
  return <img src={src} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
}

const MOSAIC_GRADIENTS = [
  'from-rose-500 to-orange-400',
  'from-blue-500 to-cyan-400',
  'from-emerald-500 to-lime-400',
  'from-violet-500 to-fuchsia-400',
]
function SeriesMosaicGradient({ title, idx }: { title: string; idx: number }) {
  const grad = MOSAIC_GRADIENTS[(title.charCodeAt(0) + idx) % MOSAIC_GRADIENTS.length]
  return (
    <div className={`w-full h-full bg-gradient-to-br ${grad} flex items-center justify-center`}>
      <span className="text-white text-xl font-bold opacity-30 select-none">{title.charAt(0).toUpperCase()}</span>
    </div>
  )
}

type StatusFilter = 'all' | 'ongoing' | 'completed' | 'hiatus' | 'cancelled'
type ArcsFilter = 'all' | 'with' | 'without'
type ReadingFilter = 'all' | 'unread' | 'reading' | 'read_all'
type SeriesViewMode = 'grid' | 'table'
type ReadingState = 'unread' | 'reading' | 'read_all'

function readingState(s: Series): ReadingState {
  if (s.book_count > 0 && s.read_count >= s.book_count) return 'read_all'
  if (s.read_count > 0 || s.reading_count > 0) return 'reading'
  return 'unread'
}

function ReadingStatePill({ state }: { state: ReadingState }) {
  if (state === 'read_all') return <span className="inline-flex items-center rounded-full bg-green-50 dark:bg-green-950/50 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400 ring-1 ring-green-200 dark:ring-green-800">Read</span>
  if (state === 'reading') return <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-800">Reading</span>
  return null
}

function SeriesTab({ libraryId, setExtraCrumbs }: SeriesTabProps) {
  const { callApi } = useAuth()
  const navigate = useNavigate()
  // Series detail is URL-driven — `seriesId` is in the path when viewing one.
  // This makes detail pages shareable via URL.
  const { seriesId } = useParams<{ seriesId?: string }>()
  const [seriesList, setSeriesList] = useState<Series[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showSuggest, setShowSuggest] = useState(false)
  const [editSeries, setEditSeries] = useState<Series | null>(null)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [arcsFilter, setArcsFilter] = useState<ArcsFilter>('all')
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>('all')
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [viewMode, setViewMode] = useState<SeriesViewMode>(() =>
    (localStorage.getItem('librarium:series:viewMode') as SeriesViewMode) === 'table' ? 'table' : 'grid'
  )
  // Same preference key as BooksTab — single toggle controls cover badges and
  // series-card reading-state pills. Defaults true; respects the localStorage
  // value written by BooksTab when it loaded the server preference.
  const showReadBadges = localStorage.getItem('librarium:show_read_badges') !== 'false'

  // Detail-view crumbs are managed by SeriesDetailView itself once the series
  // loads — it knows the name. List view crumb is just "Series".
  useEffect(() => {
    if (!seriesId) setExtraCrumbs([{ label: 'Series' }])
  }, [seriesId, setExtraCrumbs])

  useEffect(() => {
    callApi<Tag[]>(`/api/v1/libraries/${libraryId}/tags`).then(ts => setAllTags(ts ?? [])).catch(() => {})
  }, [callApi, libraryId])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (tagFilter) params.set('tag', tagFilter)
      const list = await callApi<Series[]>(`/api/v1/libraries/${libraryId}/series?${params}`)
      setSeriesList(list ?? [])
    } catch { /* ignore */ }
    finally { setIsLoading(false) }
  }, [callApi, libraryId, search, tagFilter])

  useEffect(() => { load() }, [load])

  // Client-side post-filter for the toggles — server already handled text + tag.
  const visibleSeries = useMemo(() => {
    return seriesList.filter(s => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (arcsFilter === 'with' && s.arc_count === 0) return false
      if (arcsFilter === 'without' && s.arc_count > 0) return false
      if (readingFilter !== 'all' && readingState(s) !== readingFilter) return false
      return true
    })
  }, [seriesList, statusFilter, arcsFilter, readingFilter])

  function setViewModeAndSave(m: SeriesViewMode) {
    setViewMode(m)
    localStorage.setItem('librarium:series:viewMode', m)
  }

  const deleteSeries = async (s: Series) => {
    if (!confirm(`Delete series "${s.name}"?`)) return
    await callApi(`/api/v1/libraries/${libraryId}/series/${s.id}`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  if (seriesId) {
    return (
      <SeriesDetailView
        seriesId={seriesId}
        libraryId={libraryId}
        setExtraCrumbs={setExtraCrumbs}
        onBack={() => { navigate(`/libraries/${libraryId}/series`); load() }}
      />
    )
  }

  const filterPill = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-all ${active ? 'bg-gray-700 text-white ring-transparent' : 'bg-white dark:bg-gray-800 ring-gray-300 dark:ring-gray-600 text-gray-600 dark:text-gray-300 hover:ring-gray-400'}`

  return (
    <div>
      {/* Search bar + view toggle + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search series…"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        {/* View mode toggle — same as BooksTab; table-then-grid order */}
        <div className="flex items-center rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden flex-shrink-0">
          <button
            onClick={() => setViewModeAndSave('table')}
            className={`px-2.5 py-2 transition-colors ${viewMode === 'table' ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            title="Table view">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <button
            onClick={() => setViewModeAndSave('grid')}
            className={`px-2.5 py-2 transition-colors ${viewMode === 'grid' ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            title="Card view">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
        </div>
        <button onClick={() => setShowSuggest(true)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap">
          Suggest series
        </button>
        <button onClick={() => setShowCreate(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap">
          New series
        </button>
      </div>

      {/* Filter row: status / arcs / completion */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 mr-1">Status</span>
          {(['all', 'ongoing', 'completed', 'hiatus', 'cancelled'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={filterPill(statusFilter === s)}>
              {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 mr-1">Arcs</span>
          {(['all', 'with', 'without'] as ArcsFilter[]).map(a => (
            <button key={a} onClick={() => setArcsFilter(a)} className={filterPill(arcsFilter === a)}>
              {a === 'all' ? 'All' : a === 'with' ? 'With arcs' : 'No arcs'}
            </button>
          ))}
        </div>
        {showReadBadges && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 mr-1">Reading</span>
            {([
              ['all', 'All'],
              ['unread', 'Unread'],
              ['reading', 'Reading'],
              ['read_all', 'Read all'],
            ] as [ReadingFilter, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setReadingFilter(v)} className={filterPill(readingFilter === v)}>{label}</button>
            ))}
          </div>
        )}
      </div>

      {/* Tag chips */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setTagFilter('')}
            className={filterPill(!tagFilter)}>
            All tags
          </button>
          {allTags.map(tag => (
            <button key={tag.id}
              onClick={() => setTagFilter(tagFilter === tag.name ? '' : tag.name)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-all ${tagFilter === tag.name ? 'ring-transparent text-white' : 'bg-white dark:bg-gray-800 ring-gray-300 dark:ring-gray-600 text-gray-600 dark:text-gray-300 hover:ring-gray-400'}`}
              style={tagFilter === tag.name ? { backgroundColor: tag.color || '#6b7280' } : tag.color ? { color: tag.color } : undefined}>
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {isLoading && <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-16">Loading…</div>}

      {!isLoading && visibleSeries.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-12 text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
            {(search || tagFilter || statusFilter !== 'all' || arcsFilter !== 'all' || readingFilter !== 'all')
              ? 'No series match your filters.'
              : 'No series yet'}
          </p>
          {!search && !tagFilter && statusFilter === 'all' && arcsFilter === 'all' && readingFilter === 'all' && (
            <button onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
              Create your first series
            </button>
          )}
        </div>
      )}

      {!isLoading && visibleSeries.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {visibleSeries.map(s => {
            const total = s.total_count ?? 0
            const rs = readingState(s)
            return (
              <div key={s.id}
                className="group relative flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
                <Link to={`/libraries/${libraryId}/series/${s.id}`}
                  className="flex flex-col flex-1 p-3 text-left">
                  <div className="self-center mb-3">
                    <SeriesMosaic series={s} />
                  </div>
                  <p className="font-medium text-sm text-gray-900 dark:text-white line-clamp-2 group-hover:text-blue-600 transition-colors">{s.name}</p>
                  {/* Metadata block pinned to the bottom so it lines up across cards
                      regardless of how many lines the title takes. */}
                  <div className="mt-auto pt-2 flex flex-col gap-1.5">
                    <div className="flex items-center flex-wrap gap-1 min-h-[1.5rem]">
                      {showReadBadges && <ReadingStatePill state={rs} />}
                      {s.arc_count > 0 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{s.arc_count} arc{s.arc_count !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {seriesStatusLabel(s.status)} · {s.book_count}{total > 0 ? ` / ${total}` : ''} owned
                      {showReadBadges && s.read_count > 0 && rs !== 'read_all' && (
                        <span> · {s.read_count} read</span>
                      )}
                    </div>
                  </div>
                </Link>
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setEditSeries(s)}
                    className="p-1 rounded bg-white/90 dark:bg-gray-900/90 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 shadow-sm transition-colors"
                    title="Edit series">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                  <button onClick={() => deleteSeries(s)}
                    className="p-1 rounded bg-white/90 dark:bg-gray-900/90 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 shadow-sm transition-colors"
                    title="Delete series">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!isLoading && visibleSeries.length > 0 && viewMode === 'table' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                {['', 'Name', 'Status', 'Tags', 'Volumes', 'Arcs', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {visibleSeries.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <td className="pl-4 pr-2 py-2"><SeriesMosaic series={s} size="sm" /></td>
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/libraries/${libraryId}/series/${s.id}`)} className="text-left group">
                      <p className="font-medium text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors">{s.name}</p>
                      {s.description && <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-xs">{s.description}</p>}
                      {s.demographic && <p className="text-xs text-gray-400 dark:text-gray-500">{s.demographic}</p>}
                    </button>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{seriesStatusLabel(s.status)}</span>
                      {showReadBadges && <ReadingStatePill state={readingState(s)} />}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.tags && s.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {s.tags.map(tag => (
                          <span key={tag.id}
                            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: tag.color || '#6b7280' }}>
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {s.book_count}{s.total_count != null ? ` / ${s.total_count}` : ''}
                    {s.next_release_date && (
                      <p className="text-gray-400 dark:text-gray-500">
                        Next: {new Date(s.next_release_date + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {s.arc_count > 0 ? `${s.arc_count} arc${s.arc_count !== 1 ? 's' : ''}` : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => setEditSeries(s)}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 transition-colors">Edit</button>
                      <button onClick={() => deleteSeries(s)}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 transition-colors">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showCreate || editSeries) && (
        <SeriesFormModal
          libraryId={libraryId}
          series={editSeries}
          onClose={() => { setShowCreate(false); setEditSeries(null) }}
          onSaved={() => { setShowCreate(false); setEditSeries(null); load() }}
        />
      )}

      {showSuggest && (
        <SuggestSeriesModal
          libraryId={libraryId}
          onClose={() => setShowSuggest(false)}
          onCreated={() => { setShowSuggest(false); load() }}
        />
      )}
    </div>
  )
}

// ─── Loans tab ────────────────────────────────────────────────────────────────

interface LoansTabProps {
  libraryId: string
}

type LoanStatusFilter = 'all' | 'active' | 'returned'
type LoanOverdueFilter = 'all' | 'overdue'

function LoansTab({ libraryId }: LoansTabProps) {
  const { callApi } = useAuth()
  const [loans, setLoans] = useState<Loan[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<LoanStatusFilter>('active')
  const [overdueFilter, setOverdueFilter] = useState<LoanOverdueFilter>('all')
  const [showNew, setShowNew] = useState(false)
  const [editLoan, setEditLoan] = useState<Loan | null>(null)
  const [search, setSearch] = useState('')

  // Server returns active-only by default; ask for everything when the
  // status filter could include returned loans, then client-side filter.
  const includeReturned = statusFilter !== 'active'

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('include_returned', String(includeReturned))
      if (search) params.set('search', search)
      const list = await callApi<Loan[]>(`/api/v1/libraries/${libraryId}/loans?${params}`)
      setLoans(list ?? [])
    } catch { /* ignore */ }
    finally { setIsLoading(false) }
  }, [callApi, libraryId, includeReturned, search])

  useEffect(() => { load() }, [load])

  const today = new Date().toISOString().slice(0, 10)
  const isOverdue = (loan: Loan) => !loan.returned_at && loan.due_date && loan.due_date < today

  // Client-side post-filters for status (when 'returned') and overdue.
  // Server already handled text + tag, and gated returned-vs-active.
  const visibleLoans = useMemo(() => loans.filter(l => {
    if (statusFilter === 'returned' && !l.returned_at) return false
    if (overdueFilter === 'overdue' && !isOverdue(l)) return false
    return true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [loans, statusFilter, overdueFilter])

  const markReturned = async (loan: Loan) => {
    await callApi(`/api/v1/libraries/${libraryId}/loans/${loan.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        loaned_to: loan.loaned_to,
        due_date: loan.due_date,
        returned_at: today,
        notes: loan.notes,
      }),
    }).catch(() => {})
    load()
  }

  const deleteLoan = async (loan: Loan) => {
    if (!confirm(`Delete loan of "${loan.book_title}" to ${loan.loaned_to}?`)) return
    await callApi(`/api/v1/libraries/${libraryId}/loans/${loan.id}`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  const filterPill = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-all ${active ? 'bg-gray-700 text-white ring-transparent' : 'bg-white dark:bg-gray-800 ring-gray-300 dark:ring-gray-600 text-gray-600 dark:text-gray-300 hover:ring-gray-400'}`

  const showReturnedColumn = statusFilter !== 'active'

  return (
    <div>
      {/* Search bar + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search loans…"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        {/* Every filter the list applies is forwarded, including the two the
            screen applies after the fetch — otherwise a Returned export would
            carry active loans and an Overdue export would carry all of them. */}
        <ExportButton
          urlFor={format => loansExportUrl(libraryId, format, {
            search,
            includeReturned,
            status: statusFilter,
            overdueOnly: overdueFilter === 'overdue',
          })}
          fallbackName="library-loans"
          disabled={visibleLoans.length === 0}
        />
        <button onClick={() => setShowNew(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap">
          New loan
        </button>
      </div>

      {/* Filter row: status / overdue */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 mr-1">Status</span>
          {([
            ['active', 'Active'],
            ['returned', 'Returned'],
            ['all', 'All'],
          ] as [LoanStatusFilter, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setStatusFilter(v)} className={filterPill(statusFilter === v)}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 mr-1">Overdue</span>
          {([
            ['all', 'All'],
            ['overdue', 'Overdue only'],
          ] as [LoanOverdueFilter, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setOverdueFilter(v)} className={filterPill(overdueFilter === v)}>{label}</button>
          ))}
        </div>
      </div>

      {isLoading && <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-16">Loading…</div>}

      {!isLoading && visibleLoans.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            {search || overdueFilter !== 'all'
              ? 'No loans match your filters.'
              : statusFilter === 'returned' ? 'No returned loans yet.'
              : statusFilter === 'all' ? 'No loans recorded yet.'
              : 'No active loans.'}
          </p>
          {!search && overdueFilter === 'all' && (
            <button onClick={() => setShowNew(true)}
              className="text-sm text-blue-600 hover:underline">Record a loan</button>
          )}
        </div>
      )}

      {!isLoading && visibleLoans.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                {['Book', 'Loaned to', 'Loaned', 'Due', showReturnedColumn ? 'Returned' : '', ''].map((h, i) => (
                  h ? <th key={i} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{h}</th>
                    : <th key={i} />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {visibleLoans.map(loan => (
                <tr key={loan.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/libraries/${loan.library_id}/books/${loan.book_id}`}
                      className="text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                      {loan.book_title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{loan.loaned_to}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{loan.loaned_at}</td>
                  <td className="px-4 py-3 text-xs">
                    {loan.due_date ? (
                      <span className={isOverdue(loan) ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-gray-400'}>
                        {loan.due_date}{isOverdue(loan) && ' ⚠'}
                      </span>
                    ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                  {showReturnedColumn && (
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {loan.returned_at ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {!loan.returned_at && (
                        <button onClick={() => markReturned(loan)}
                          className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          title="Mark returned">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                      <button onClick={() => setEditLoan(loan)}
                        className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        title="Edit loan">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </button>
                      <button onClick={() => deleteLoan(loan)}
                        className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        title="Delete loan">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showNew || editLoan) && (
        <LoanFormModal
          libraryId={libraryId}
          loan={editLoan}
          onClose={() => { setShowNew(false); setEditLoan(null) }}
          onSaved={() => { setShowNew(false); setEditLoan(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LibraryPage({ section }: { section: 'books' | 'shelves' | 'series' | 'loans' | 'members' }) {
  const { libraryId } = useParams<{ libraryId: string }>()
  const { callApi, user } = useAuth()
  const { library, mediaTypes, setExtraCrumbs } = useOutletContext<LibraryOutletContext>()

  useEffect(() => {
    const labels: Record<string, string> = {
      books: 'Books', shelves: 'Shelves', series: 'Series', loans: 'Loans', members: 'Members',
    }
    setExtraCrumbs([{ label: labels[section] }])
  }, [section, setExtraCrumbs])

  // Members state — only used by the members section
  const [members, setMembers] = useState<LibraryMember[] | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showAddMember, setShowAddMember] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')

  const loadMembers = useCallback(async () => {
    if (!libraryId) return
    try {
      const params = new URLSearchParams()
      if (memberSearch) params.set('search', memberSearch)
      const ms = await callApi<LibraryMember[]>(`/api/v1/libraries/${libraryId}/members?${params}`)
      setMembers(ms ?? [])
    } catch { /* non-fatal */ }
  }, [callApi, libraryId, memberSearch])

  useEffect(() => {
    if (section === 'members') loadMembers()
  }, [section, loadMembers])

  const removeMember = async (userId: string) => {
    if (!confirm('Remove this member?')) return
    setActionError(null)
    try {
      await callApi(`/api/v1/libraries/${libraryId}/members/${userId}`, { method: 'DELETE' })
      await loadMembers()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to remove member')
    }
  }

  const roleLabel: Record<string, string> = { library_owner: 'Owner', library_editor: 'Editor', library_viewer: 'Viewer' }

  if (!library || !libraryId) return null

  return (
    <div className="p-8">
      {section === 'members' && (
        <div className="flex justify-end mb-6">
          <button onClick={() => setShowAddMember(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
            Add member
          </button>
        </div>
      )}

      {section === 'books' && (
        <BooksTab libraryId={libraryId} mediaTypes={mediaTypes}
          canEdit={!!(user?.is_instance_admin || library?.owner_id === user?.id)} />
      )}

      {section === 'shelves' && (
        <ShelvesTab libraryId={libraryId} setExtraCrumbs={setExtraCrumbs} />
      )}

      {section === 'series' && (
        <SeriesTab libraryId={libraryId} setExtraCrumbs={setExtraCrumbs} />
      )}

      {section === 'loans' && (
        <LoansTab libraryId={libraryId} />
      )}

      {section === 'members' && (
        <>
          {actionError && (
            <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">{actionError}</div>
          )}
          <div className="mb-4 relative">
            <input
              type="text"
              value={memberSearch}
              onChange={e => setMemberSearch(e.target.value)}
              placeholder="Search members…"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  {['User', 'Email', 'Tags', 'Role', 'Joined', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {!members && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</td></tr>}
                {members?.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">{memberSearch ? 'No members match your search.' : 'No members yet.'}</td></tr>}
                {members?.map(m => (
                  <tr key={m.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{m.display_name}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{m.email}</td>
                    <td className="px-4 py-3">
                      {m.tags && m.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {m.tags.map(tag => (
                            <span key={tag.id}
                              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium text-white"
                              style={{ backgroundColor: tag.color || '#6b7280' }}>
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300">
                        {roleLabel[m.role] ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{new Date(m.joined_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      {m.role !== 'library_owner' && (
                        <button onClick={() => removeMember(m.user_id)}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 transition-colors">Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {showAddMember && (
            <AddMemberModal libraryId={libraryId}
              onClose={() => setShowAddMember(false)}
              onAdded={() => { setShowAddMember(false); loadMembers() }} />
          )}
        </>
      )}
    </div>
  )
}

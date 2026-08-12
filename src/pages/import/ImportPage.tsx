// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 fireball1725

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useAuth } from '../../auth/AuthContext'
import type { Library, LibraryMember } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportJob {
  id: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  total_rows: number
  processed_rows: number
  failed_rows: number
  skipped_rows: number
}

// ─── Field definitions ────────────────────────────────────────────────────────

// Field names match what the api worker reads out of `row[...]`. Adding
// a value here extends the column-mapping UI and exposes it for source
// presets to target. Section breaks below are visual only — the worker
// doesn't care how the fields are grouped.
const IMPORT_FIELDS: { value: string; label: string }[] = [
  // Book metadata
  { value: 'title',         label: 'Title' },
  { value: 'subtitle',      label: 'Subtitle' },
  { value: 'isbn_13',       label: 'ISBN-13' },
  { value: 'isbn_10',       label: 'ISBN-10' },
  { value: 'author',        label: 'Author' },
  { value: 'publisher',     label: 'Publisher' },
  { value: 'publish_date',  label: 'Publish Date' },
  { value: 'acquired_date', label: 'Acquired Date' },
  { value: 'description',   label: 'Description' },
  { value: 'page_count',    label: 'Page Count' },
  { value: 'language',      label: 'Language' },
  { value: 'tags',          label: 'Tags' },
  { value: 'media_type',    label: 'Media Type' },
  // User interaction (per-importer; written to user_book_interactions)
  { value: 'read_status',   label: 'Read status' },
  { value: 'rating',        label: 'Rating' },
  { value: 'review',        label: 'Review' },
  { value: 'notes',         label: 'Notes' },
  { value: 'date_started',  label: 'Started reading' },
  { value: 'date_finished', label: 'Finished reading' },
  { value: 'is_favorite',   label: 'Favourite' },
]

const FORMAT_OPTIONS = [
  { value: 'paperback',  label: 'Paperback' },
  { value: 'hardcover',  label: 'Hardcover' },
  { value: 'ebook',      label: 'E-Book' },
  { value: 'audiobook',  label: 'Audiobook' },
  { value: 'digital',    label: 'Digital' },
]

// ─── Source presets ──────────────────────────────────────────────────────────
//
// Each preset maps a known CSV header (verbatim, case-sensitive) to a
// Librarium import field. Picking a source from the dropdown reseats
// the column mapping using its preset; headers not in the preset fall
// back to the fuzzy autoDetect heuristic so additional columns aren't
// silently ignored.
//
// Verified against real exports from each source (April 2026 column
// shapes). If a source changes its export format, update its entry —
// the rest of the UI is preset-agnostic.

type Source = 'generic' | 'goodreads' | 'storygraph' | 'libib'

interface Preset {
  label: string
  // Header → Librarium field. Header keys are matched verbatim.
  columnMap: Record<string, string>
}

const SOURCE_PRESETS: Record<Source, Preset> = {
  generic: {
    label: 'Generic CSV (auto-detect)',
    columnMap: {},
  },
  goodreads: {
    label: 'Goodreads',
    columnMap: {
      'Title':           'title',
      'Author':          'author',
      'ISBN':            'isbn_10',
      'ISBN13':          'isbn_13',
      'My Rating':       'rating',
      'Publisher':       'publisher',
      'Number of Pages': 'page_count',
      'Year Published':  'publish_date',
      'Date Read':       'date_finished',
      'Bookshelves':     'tags',
      'Exclusive Shelf': 'read_status',
      'My Review':       'review',
      'Private Notes':   'notes',
    },
  },
  storygraph: {
    label: 'StoryGraph',
    columnMap: {
      'Title':          'title',
      'Authors':        'author',
      'ISBN/UID':       'isbn_13',
      'Read Status':    'read_status',
      'Last Date Read': 'date_finished',
      'Star Rating':    'rating',
      'Review':         'review',
      'Tags':           'tags',
    },
  },
  libib: {
    label: 'Libib',
    columnMap: {
      'title':        'title',
      'creators':     'author',
      'ean_isbn13':   'isbn_13',
      'upc_isbn10':   'isbn_10',
      'description':  'description',
      'publisher':    'publisher',
      'publish_date': 'publish_date',
      'tags':         'tags',
      'length':       'page_count',
      'rating':       'rating',
      'review':       'review',
      'notes':        'notes',
      'status':       'read_status',
      'began':        'date_started',
      'completed':    'date_finished',
      'added':        'acquired_date',
    },
  },
}

// detectSource sniffs a small number of headers that are highly
// distinctive to each tracker. Goodreads is easiest because
// `Exclusive Shelf` is unique to it; Libib's `creators` + `ean_isbn13`
// pair is unmistakable; StoryGraph uses `Read Status` paired with
// `Star Rating`. Returns 'generic' when no source clearly matches.
function detectSource(headers: string[]): Source {
  const set = new Set(headers)
  if (set.has('Exclusive Shelf') || set.has('My Rating')) return 'goodreads'
  if (set.has('Read Status') && set.has('Star Rating')) return 'storygraph'
  if (set.has('ean_isbn13') || set.has('creators')) return 'libib'
  return 'generic'
}

// ─── Auto-detect ──────────────────────────────────────────────────────────────
//
// Fuzzy fallback used when a header isn't claimed by the active source
// preset. Strips delimiters/case and matches against a small set of
// common variants so that vanilla CSVs people produce by hand still
// land in the right field without needing a preset.
function autoDetect(header: string): string {
  const h = header.toLowerCase().replace(/[\s\-_.]/g, '')

  // Book metadata
  if (['isbn13', 'isbn', 'ean', 'barcode', 'ean13', 'eanisbn13', 'eanisbn'].includes(h)) return 'isbn_13'
  if (['isbn10', 'upc', 'upcisbn10', 'upcisbn', 'upc10'].includes(h)) return 'isbn_10'
  if (['title', 'booktitle', 'name', 'worktitle'].includes(h)) return 'title'
  if (['subtitle', 'sub', 'booktitlesubtitle'].includes(h)) return 'subtitle'
  if (['author', 'authors', 'writer', 'authorlf', 'authorname', 'creators', 'creator', 'artist'].includes(h)) return 'author'
  if (['publisher', 'pub', 'publishedby'].includes(h)) return 'publisher'
  if (['yearpublished', 'originalpublicationyear', 'publisheddate', 'publishdate', 'publicationdate'].includes(h)) return 'publish_date'
  if (['acquiredat', 'acquireddate', 'dateacquired', 'purchasedate', 'datepurchased', 'added', 'dateadded'].includes(h)) return 'acquired_date'
  if (['description', 'summary', 'synopsis'].includes(h)) return 'description'
  if (['pagecount', 'pages', 'numberofpages', 'length', 'numpages', 'pagenum'].includes(h)) return 'page_count'
  if (['language', 'lang', 'booklanguage'].includes(h)) return 'language'
  if (['tags', 'tag', 'genre', 'genres', 'category', 'categories', 'subjects', 'subject', 'bookshelves'].includes(h)) return 'tags'
  if (['mediatype', 'type', 'format', 'booktype', 'bookformat', 'bindingtype'].includes(h)) return 'media_type'

  // User interaction
  if (['rating', 'myrating', 'starrating', 'usrrating'].includes(h)) return 'rating'
  if (['review', 'myreview'].includes(h)) return 'review'
  if (['notes', 'note', 'privatenotes'].includes(h)) return 'notes'
  if (['readstatus', 'status', 'exclusiveshelf'].includes(h)) return 'read_status'
  if (['began', 'datestarted', 'startedreading', 'startdate'].includes(h)) return 'date_started'
  if (['completed', 'datefinished', 'datefinishedreading', 'finishdate', 'dateread', 'lastdateread', 'finishedreading'].includes(h)) return 'date_finished'
  if (['favorite', 'favourite', 'isfavorite', 'isfavourite'].includes(h)) return 'is_favorite'

  return ''
}

// applyMapping computes the colIndex → field map for a given source
// preset and a list of CSV headers. Headers in the preset's columnMap
// are matched verbatim; everything else falls through to autoDetect.
// The colIndex-keyed shape matches what the existing UI consumes.
function applyMapping(headers: string[], source: Source): Record<number, string> {
  const out: Record<number, string> = {}
  const claimed = new Set<string>()
  const preset = SOURCE_PRESETS[source].columnMap
  headers.forEach((h, i) => {
    let target = preset[h] ?? ''
    if (!target) target = autoDetect(h)
    // Each Librarium field is claimed by at most one column — first
    // mapping wins, mirroring the historical behaviour.
    if (target && !claimed.has(target)) {
      out[i] = target
      claimed.add(target)
    } else {
      out[i] = ''
    }
  })
  return out
}

// ─── CSV preview parser ───────────────────────────────────────────────────────
// Returns headers (first row) and a pool of data rows the UI samples
// from. We cap at PREVIEW_POOL_SIZE so a 50k-row file doesn't block
// the main thread; that's still far more than we'd ever show at once,
// so the random-draw button has plenty of variety to cycle through.

const PREVIEW_POOL_SIZE = 1000

function parseCSVPreview(text: string): { headers: string[]; samples: string[][] } {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = raw.split('\n')[0] ?? ''
  const commas = (firstLine.match(/,/g) ?? []).length
  const semis  = (firstLine.match(/;/g) ?? []).length
  const tabs   = (firstLine.match(/\t/g) ?? []).length
  const delim  = tabs > commas && tabs > semis ? '\t' : semis > commas ? ';' : ','

  // Single-pass character walker that respects quoted fields. Libib /
  // Goodreads exports routinely embed newlines inside the description
  // column; splitting on `\n` first would smear those rows across the
  // table and assign description fragments to unrelated columns.
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQ = false
  const pushField = () => {
    row.push(field.trim().replace(/^"|"$/g, ''))
    field = ''
  }
  const pushRow = () => {
    pushField()
    // Skip blank rows produced by trailing newlines.
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') {
      if (inQ && raw[i + 1] === '"') { field += '"'; i++ }
      else inQ = !inQ
    } else if (ch === delim && !inQ) {
      pushField()
    } else if (ch === '\n' && !inQ) {
      pushRow()
      if (rows.length > PREVIEW_POOL_SIZE) break
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) pushRow()

  if (rows.length === 0) return { headers: [], samples: [] }
  return { headers: rows[0], samples: rows.slice(1) }
}

// pickPreviewIndices returns up to `count` row indices into the sample
// pool. The pool is shuffled with a Fisher-Yates pass so duplicates
// don't appear within a single draw, then we slice. seed exists only to
// trip the dependency array in callers — JS doesn't expose seedable
// Math.random, but a stable shuffle per render is enough.
function pickPreviewIndices(poolSize: number, count: number): number[] {
  if (poolSize <= count) {
    return Array.from({ length: poolSize }, (_, i) => i)
  }
  const order = Array.from({ length: poolSize }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order.slice(0, count)
}

// ─── Import caveats ───────────────────────────────────────────────────────────

// What a CSV import cannot restore, stated where someone is about to rely on
// it. Every line below is a real limit of the import worker, not a caution:
// it reads one row as one book keyed on ISBN, and writes only the fields the
// mapping names. A book exported with several editions comes back with one;
// series, shelves and copy counts were never import fields at all.
//
// Kept as a collapsed <details> so it informs without lecturing anyone
// importing a Goodreads file for the first time.
function ImportCaveats() {
  return (
    <details className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-amber-900 dark:text-amber-200">
        What a CSV import can and can&rsquo;t restore
      </summary>
      <div className="mt-2 space-y-2 text-xs text-amber-900/90 dark:text-amber-200/80">
        <p>
          A row becomes one book, matched on ISBN when the row has one — rows
          without an ISBN always create a new book. Titles, authors, edition details,
          tags, and your reading status, rating, review, notes and dates all come back
          from the columns you map below.
        </p>
        <p>
          These are not import fields, so they are <strong>not</strong> restored even
          when a Librarium export includes them as columns: series and volume position,
          shelves, copy counts (each import counts as one copy), reading progress and
          re-read counts. Covers and ebook or audiobook files are in neither format —
          enable “fetch covers” below to look them up again.
        </p>
        <p>
          Only the primary edition survives a CSV round trip. If a book&rsquo;s
          <code className="mx-1 rounded bg-amber-100 dark:bg-amber-900/40 px-1">edition_count</code>
          column is above 1, its other editions — and anything you rated or noted
          against them — are only in the JSON export.
        </p>
        <p className="text-amber-800/80 dark:text-amber-200/60">
          None of this is a backup. A full copy of a self-hosted instance is a database
          dump plus the cover and media directories.
        </p>
      </div>
    </details>
  )
}

// ─── Step indicator ───────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Library' },
  { n: 2, label: 'Upload & Map' },
  { n: 3, label: 'Progress' },
  { n: 4, label: 'Results' },
]

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
              current === s.n
                ? 'bg-blue-600 text-white'
                : current > s.n
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
            }`}>
              {current > s.n ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : s.n}
            </div>
            <span className={`text-sm font-medium ${
              current === s.n ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'
            }`}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`mx-3 h-px w-10 transition-colors ${
              current > s.n ? 'bg-blue-400 dark:bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
            }`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── ImportPage ───────────────────────────────────────────────────────────────

export default function ImportPage() {
  const { callApi, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  usePageTitle('Import Books')

  const [step, setStep] = useState<Step>(1)

  // Step 1 — library selection
  const [libraries, setLibraries] = useState<Library[]>([])
  const [libsLoading, setLibsLoading] = useState(true)
  const [selectedLibrary, setSelectedLibrary] = useState<Library | null>(null)

  // Step 2 — upload & map
  const [isDragging, setIsDragging] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [csvSamples, setCsvSamples] = useState<string[][]>([])
  // sampleSeed bumps when the user clicks "shuffle" — the example draw
  // recomputes off it so the column-mapping table can show varied rows.
  const [sampleSeed, setSampleSeed] = useState(0)
  // source picks the per-tracker preset that pre-fills csvMapping;
  // 'generic' falls back to autoDetect for every column.
  const [source, setSource] = useState<Source>('generic')
  // csvMapping: colIndex → internal field name ('' = skip)
  const [csvMapping, setCsvMapping] = useState<Record<number, string>>({})
  const [defaultFormat, setDefaultFormat] = useState('paperback')
  // Library members for the attribution dropdown. Loaded lazily on
  // step 2 entry. Non-admins never see the dropdown so they don't pay
  // the fetch.
  const [members, setMembers] = useState<LibraryMember[]>([])
  const [attributeToUserId, setAttributeToUserId] = useState<string>(user?.id ?? '')
  // Duplicate handling: when both flags are off (the default) a duplicate
  // ISBN is left untouched. They compose, so a user can opt into both.
  const [duplicateIncrementCount, setDuplicateIncrementCount] = useState(false)
  const [duplicateUpdateFromCSV, setDuplicateUpdateFromCSV] = useState(false)
  const [enrichMetadata, setEnrichMetadata] = useState(false)
  const [enrichCovers, setEnrichCovers] = useState(false)
  const [useAICleanup, setUseAICleanup] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 3 — progress
  const [importJob, setImportJob] = useState<ImportJob | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load libraries on mount. Three auto-advance paths skip step 1 when
  // the choice is unambiguous: an explicit ?library=<id> preselect, a
  // single-library account (the Libib-replacement case for most
  // self-hosters), or the user landed on /import via a per-library
  // shortcut. Step 1 only lingers when the user actually has a choice.
  useEffect(() => {
    const preselect = searchParams.get('library')
    callApi<Library[]>('/api/v1/libraries')
      .then(libs => {
        const list = libs ?? []
        setLibraries(list)
        if (preselect) {
          const match = list.find(l => l.id === preselect)
          if (match) { setSelectedLibrary(match); setStep(2); return }
        }
        if (list.length === 1) {
          setSelectedLibrary(list[0])
          setStep(2)
        }
      })
      .catch(() => setLibraries([]))
      .finally(() => setLibsLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cleanup poll on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // Lazy-load library members once a library is picked. Only admins
  // can attribute imports to other users, so non-admins skip the fetch
  // entirely — the dropdown won't render for them anyway.
  useEffect(() => {
    if (!selectedLibrary || !user?.is_instance_admin) {
      setMembers([])
      return
    }
    callApi<LibraryMember[]>(`/api/v1/libraries/${selectedLibrary.id}/members`)
      .then(list => setMembers(list ?? []))
      .catch(() => setMembers([]))
  }, [selectedLibrary, user?.is_instance_admin, callApi])

  // ── File handling ─────────────────────────────────────────────────────────

  const processFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const { headers: hdrs, samples } = parseCSVPreview(text)
      if (hdrs.length === 0 || (hdrs.length === 1 && !hdrs[0])) {
        setSubmitError('The file appears empty or invalid.')
        return
      }
      // Sniff the source from the headers — if it's clearly a known
      // tracker we set the dropdown for the user and use that
      // preset's verbatim column-map. Otherwise we land on 'generic'
      // and rely on the fuzzy autoDetect fallback.
      const detected = detectSource(hdrs)
      const auto = applyMapping(hdrs, detected)
      setCsvFile(file)
      setHeaders(hdrs)
      setCsvSamples(samples)
      setSource(detected)
      setCsvMapping(auto)
      setSubmitError(null)
    }
    reader.readAsText(file, 'UTF-8')
  }

  // Reseats the column mapping when the user changes the source
  // dropdown.
  const handleSourceChange = (next: Source) => {
    setSource(next)
    if (headers.length === 0) return
    setCsvMapping(applyMapping(headers, next))
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleStartImport = async () => {
    if (!csvFile || !selectedLibrary) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      // Invert: colIndex→field to field→colIndex (first mapped col wins per field)
      const mappingObj: Record<string, number> = {}
      for (const [colStr, field] of Object.entries(csvMapping)) {
        if (field && !(field in mappingObj)) {
          mappingObj[field] = Number(colStr)
        }
      }
      const formData = new FormData()
      formData.append('file', csvFile)
      formData.append('mapping', JSON.stringify(mappingObj))
      formData.append('duplicate_increment_count', duplicateIncrementCount ? 'true' : 'false')
      formData.append('duplicate_update_from_csv', duplicateUpdateFromCSV ? 'true' : 'false')
      formData.append('default_format', defaultFormat)
      formData.append('enrich_metadata', enrichMetadata ? 'true' : 'false')
      formData.append('enrich_covers', enrichCovers ? 'true' : 'false')
      formData.append('use_ai_cleanup', useAICleanup ? 'true' : 'false')
      // Only send attribution when the admin has actually retargeted —
      // omitting the field tells the API to use the caller (default).
      if (attributeToUserId && attributeToUserId !== user?.id) {
        formData.append('attribute_to_user_id', attributeToUserId)
      }
      const job = await callApi<ImportJob>(`/api/v1/libraries/${selectedLibrary.id}/imports`, {
        method: 'POST',
        body: formData,
      })
      setImportJob(job)
      setStep(3)
      startPolling(job.id, selectedLibrary.id)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start import')
    } finally {
      setIsSubmitting(false)
    }
  }

  const startPolling = (importId: string, libraryId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const job = await callApi<ImportJob>(`/api/v1/libraries/${libraryId}/imports/${importId}`)
        setImportJob(job)
        if (job.status === 'done' || job.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setStep(4)
        }
      } catch { /* non-fatal */ }
    }, 2000)
  }

  const handleReset = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setCsvFile(null)
    setHeaders([])
    setCsvSamples([])
    setSource('generic')
    setCsvMapping({})
    setAttributeToUserId(user?.id ?? '')
    setImportJob(null)
    setSubmitError(null)
    // Same auto-advance logic as the initial load — single-library
    // accounts skip step 1 on every reset, not just first load.
    if (libraries.length === 1) {
      setSelectedLibrary(libraries[0])
      setStep(2)
    } else {
      setSelectedLibrary(null)
      setStep(1)
    }
  }

  const anyMapped = Object.values(csvMapping).some(f => f !== '')

  // Track which internal fields are already claimed (for duplicate-mapping highlight)
  const fieldUsage: Record<string, number[]> = {}
  for (const [colStr, field] of Object.entries(csvMapping)) {
    if (field) {
      if (!fieldUsage[field]) fieldUsage[field] = []
      fieldUsage[field].push(Number(colStr))
    }
  }

  // Sample-row indices for the column-mapping table. Recomputed when
  // the file changes (csvSamples) or the user clicks shuffle (sampleSeed).
  // sampleSeed is intentionally read from the deps so eslint sees it
  // even though Math.random doesn't take a seed.
  const previewIndices = useMemo(
    () => pickPreviewIndices(csvSamples.length, 3),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [csvSamples, sampleSeed],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader
        title="Import Books"
        description="Select a library, upload a CSV file, and queue a background import."
      />
      <div className="p-8 max-w-3xl mx-auto">
      <StepIndicator current={step} />

      {/* ── Step 1: Select Library ──
          Only shown for accounts with multiple libraries — the load
          effect (and handleReset) auto-advance to step 2 when there
          is exactly one library, so the common Libib-replacement path
          never sees this step. */}
      {step === 1 && (
        <div className="space-y-4">
          {libsLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            </div>
          ) : libraries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-12 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No libraries found.</p>
              <Link to="/libraries" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Create a library first →
              </Link>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                Choose the library this CSV will land in.
              </p>
              <div className="grid grid-cols-1 gap-3">
                {libraries.map(lib => (
                  <button
                    key={lib.id}
                    onClick={() => { setSelectedLibrary(lib); setStep(2) }}
                    className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10 px-5 py-4 transition-colors group flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300 truncate">
                        {lib.name}
                      </p>
                      {lib.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">{lib.description}</p>
                      )}
                    </div>
                    <svg
                      className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all flex-shrink-0"
                      fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Upload & Map ── */}
      {step === 2 && selectedLibrary && (
        <div className="space-y-6">
          {/* Library badge */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Importing into:</span>
            <span className="font-semibold text-gray-900 dark:text-white">{selectedLibrary.name}</span>
            <button
              onClick={() => setStep(1)}
              className="text-blue-600 dark:text-blue-400 hover:underline text-xs"
            >
              Change
            </button>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
            onClick={() => fileInputRef.current?.click()}
            className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer p-10 text-center ${
              isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : csvFile
                  ? 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/10'
                  : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
            }`}
          >
            <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }}
              onClick={e => e.stopPropagation()}
            />
            {csvFile ? (
              <div className="flex flex-col items-center gap-2">
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="font-medium text-gray-900 dark:text-white">{csvFile.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {headers.length} column{headers.length !== 1 ? 's' : ''} — click to change
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="font-medium text-gray-700 dark:text-gray-300">Drop a CSV here, or click to browse</p>
                <p className="text-xs text-gray-400">CSV, TSV, or TXT</p>
              </div>
            )}
          </div>

          {/* Source picker — auto-detected from headers; user can override. */}
          {headers.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Importing from…</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Picking a source pre-fills the column mapping below. Detected automatically from the file's headers; override here if it picked wrong.
                  </p>
                </div>
                <select
                  value={source}
                  onChange={e => handleSourceChange(e.target.value as Source)}
                  className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {(Object.keys(SOURCE_PRESETS) as Source[]).map(s => (
                    <option key={s} value={s}>{SOURCE_PRESETS[s].label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* What a CSV cannot carry back in. Shown here rather than on the
              export side because this is the moment someone is relying on
              it: a Librarium CSV round-trips its own columns faithfully, and
              the gap is everything that was never a column. */}
          {headers.length > 0 && <ImportCaveats />}

          {/* Column mapping — one row per CSV column */}
          {headers.length > 0 && (
            <div>
              <div className="flex items-end justify-between mb-3 gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Column Mapping</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Each row is a column from your CSV. Auto-detected mappings are pre-filled — adjust any that look wrong.
                  </p>
                </div>
                {csvSamples.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setSampleSeed(s => s + 1)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors flex-shrink-0"
                    title="Show a different random sample of rows"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Shuffle examples
                  </button>
                )}
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-400 w-1/4">CSV Column</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-400 w-1/2">Examples</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-400 w-1/4">Maps To</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {headers.map((h, colIdx) => {
                      const examples = previewIndices
                        .map(rowIdx => csvSamples[rowIdx]?.[colIdx] ?? '')
                        .filter(v => v !== '')
                      const mappedField = csvMapping[colIdx] ?? ''
                      const isDuplicate = mappedField !== '' && (fieldUsage[mappedField]?.length ?? 0) > 1

                      return (
                        <tr key={colIdx} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <span className="font-mono text-xs font-medium text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                              {h || `col_${colIdx + 1}`}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="space-y-0.5">
                              {examples.length > 0 ? examples.map((ex, i) => (
                                <p key={i} className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]" title={ex}>{ex}</p>
                              )) : (
                                <span className="text-xs text-gray-300 dark:text-gray-600 italic">empty</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <select
                              value={mappedField}
                              onChange={e => setCsvMapping(prev => ({ ...prev, [colIdx]: e.target.value }))}
                              className={`w-full rounded-lg border px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                isDuplicate
                                  ? 'border-amber-400 dark:border-amber-500'
                                  : 'border-gray-300 dark:border-gray-600 focus:border-blue-500'
                              }`}
                            >
                              <option value="">— skip —</option>
                              {IMPORT_FIELDS.map(f => (
                                <option key={f.value} value={f.value}>{f.label}</option>
                              ))}
                            </select>
                            {isDuplicate && (
                              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">mapped twice</p>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Options — three labelled groups: per-row mapping, duplicate
              policy, and the post-import enrichment toggles. */}
          {headers.length > 0 && (
            <div className="space-y-4">
              {/* Mapping */}
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                <header className="px-4 pt-3.5 pb-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Mapping</h3>
                </header>
                <div className="border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Default format</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Applied when the CSV does not specify a format</p>
                    </div>
                    <select
                      value={defaultFormat}
                      onChange={e => setDefaultFormat(e.target.value)}
                      className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  {/* Admin-only attribution override. Only renders when
                      the library has more than one member; with a single
                      member there's no other choice to make. */}
                  {user?.is_instance_admin && members.length > 1 && (
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Reading data attributed to</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Read status, rating, review, and dates land on this user.</p>
                      </div>
                      <select
                        value={attributeToUserId}
                        onChange={e => setAttributeToUserId(e.target.value)}
                        className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-xs"
                      >
                        {members.map(m => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.display_name || m.username}{m.user_id === user?.id ? ' (you)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </section>

              {/* Duplicate policy */}
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                <header className="px-4 pt-3.5 pb-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">When a book already exists</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Default: do nothing. Enable either action — they compose.</p>
                </header>
                <div className="border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Add to copy count</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Bump the per-edition copy count for each duplicate row</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={duplicateIncrementCount} onChange={e => setDuplicateIncrementCount(e.target.checked)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                    </label>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Update read state, rating, review, dates</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Refresh your interaction fields from the CSV row</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={duplicateUpdateFromCSV} onChange={e => setDuplicateUpdateFromCSV(e.target.checked)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                    </label>
                  </div>
                </div>
              </section>

              {/* Post-import enrichment */}
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                <header className="px-4 pt-3.5 pb-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">After import</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Run these in the background on books this import added to the library. Pure duplicates already in this library are skipped, and books that already have the data are no-ops.</p>
                </header>
                <div className="border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Fill missing metadata</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Look each book up against metadata providers to populate blank fields</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={enrichMetadata} onChange={e => setEnrichMetadata(e.target.checked)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                    </label>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Download cover art</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Pull cover images from metadata providers for books that don't have one</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={enrichCovers} onChange={e => setEnrichCovers(e.target.checked)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                    </label>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Clean descriptions with AI</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">After enrichment, ask the configured AI to strip marketing fluff and retailer boilerplate from descriptions. Costs AI tokens per book; disabled if no AI provider is configured.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={useAICleanup} onChange={e => setUseAICleanup(e.target.checked)} disabled={!enrichMetadata} className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-blue-600 peer-disabled:opacity-50 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                    </label>
                  </div>
                </div>
              </section>
            </div>
          )}

          {submitError && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              {submitError}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleStartImport}
              disabled={!csvFile || !anyMapped || isSubmitting}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Starting…' : 'Start Import'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Progress ── */}
      {step === 3 && importJob && (() => {
        // The API treats processed/failed/skipped as disjoint buckets —
        // skipped rows are NOT a subset of processed. The progress bar
        // tracks "rows the worker has finished with", which is the sum
        // of all three. Without this, an import that skips most rows
        // (e.g. re-uploading the same CSV with duplicate handling off)
        // sits at 0% all the way through.
        const handled = importJob.processed_rows + importJob.failed_rows + importJob.skipped_rows
        const pct = importJob.total_rows > 0 ? (handled / importJob.total_rows) * 100 : 0
        return (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {importJob.status === 'pending' ? 'Queued…' : `Processing… ${handled}/${importJob.total_rows} rows`}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {importJob.total_rows > 0 ? `${Math.round(pct)}%` : '—'}
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-5">
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-center">
                <p className="text-xl font-bold text-gray-900 dark:text-white">{importJob.processed_rows}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Processed</p>
              </div>
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-center">
                <p className="text-xl font-bold text-red-600 dark:text-red-400">{importJob.failed_rows}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Failed</p>
              </div>
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-center">
                <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{importJob.skipped_rows}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Skipped</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
            <div className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            Checking for updates every 2 seconds…
          </div>
        </div>
        )
      })()}

      {/* ── Step 4: Results ── */}
      {step === 4 && importJob && (
        <div className="space-y-6">
          <div className={`rounded-xl border p-6 ${
            importJob.status === 'failed'
              ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30'
              : 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20'
          }`}>
            <div className="flex items-center gap-3 mb-4">
              {importJob.status === 'failed' ? (
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              <div>
                <p className={`font-semibold text-base ${importJob.status === 'failed' ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                  {importJob.status === 'failed' ? 'Import failed' : 'Import complete'}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {importJob.total_rows} row{importJob.total_rows !== 1 ? 's' : ''} total
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-white dark:bg-gray-900/60 px-4 py-3 text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{importJob.processed_rows}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Processed</p>
              </div>
              <div className="rounded-lg bg-white dark:bg-gray-900/60 px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{importJob.failed_rows}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Failed</p>
              </div>
              <div className="rounded-lg bg-white dark:bg-gray-900/60 px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{importJob.skipped_rows}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Skipped</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Import another file
            </button>
            <button
              onClick={() => navigate('/admin/settings/jobs')}
              className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              View all jobs
            </button>
            {selectedLibrary && (
              <Link
                to={`/libraries/${selectedLibrary.id}/books`}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                Go to Books
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  )
}

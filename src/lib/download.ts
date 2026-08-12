// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 fireball1725

/**
 * Authenticated file downloads.
 *
 * Export endpoints are plain GETs, but they still need the Bearer token, so
 * the browser can't just follow a link to them — the request is made with
 * fetch and the response is handed to a synthetic <a download> click.
 */

/** Format of an export request. Mirrors the API's `format` query parameter. */
export type ExportFormat = 'csv' | 'json'

/**
 * The formats offered, in the order they are presented.
 *
 * JSON leads because it is the one that keeps the data's shape: tags,
 * credits and genres stay as lists, and an absent value stays absent
 * instead of becoming an empty cell. CSV flattens all of that to open
 * cleanly in a spreadsheet, which is the more common want but the lossier
 * one, so it reads better as the deliberate second choice.
 *
 * Neither is an archive — a full backup of a self-hosted instance is a
 * database dump plus the cover and media directories. The hints say what
 * each format is for and stop short of implying otherwise.
 *
 * Data rather than JSX so the order is one testable fact instead of an
 * accident of markup.
 */
export const EXPORT_FORMATS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: 'json', label: 'JSON', hint: 'Structured — nothing collapsed into text' },
  { format: 'csv', label: 'CSV', hint: 'Spreadsheets — re-importable' },
]

export class DownloadError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'DownloadError'
    this.status = status
  }
}

/**
 * Fetches `path` with the caller's token and saves the response as a file.
 *
 * The filename comes from the server's Content-Disposition header when it
 * sends one (it carries the library's name and the export date), falling
 * back to `fallbackName` otherwise.
 *
 * Resolves once the download has been handed to the browser. Throws
 * DownloadError when the server refuses the request, so callers can surface
 * the reason in a toast rather than leaving the user with a silent no-op.
 */
export async function downloadAuthenticated(
  getToken: () => Promise<string | null>,
  path: string,
  fallbackName: string,
): Promise<{ truncated: boolean }> {
  const token = await getToken()

  let res: Response
  try {
    res = await fetch(path, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
  } catch {
    throw new DownloadError(0, 'Cannot connect to server')
  }

  if (!res.ok) {
    // Errors come back as the API's usual JSON envelope, not as the file.
    let message = `Export failed (HTTP ${res.status})`
    try {
      const body = await res.json() as { error?: string }
      if (body?.error) message = body.error
    } catch { /* non-JSON error body — keep the generic message */ }
    throw new DownloadError(res.status, message)
  }

  const blob = await res.blob()
  saveBlob(blob, filenameFromResponse(res) ?? fallbackName)
  // The server caps very large exports and says so in a header. Saving the
  // file and staying silent would hand someone a partial library that looks
  // complete, so the caller is told to warn.
  return { truncated: res.headers.get('X-Export-Truncated') === 'true' }
}

/**
 * Reads the filename out of a Content-Disposition header.
 *
 * Prefers RFC 6266's `filename*` (percent-encoded UTF-8) so libraries with
 * non-ASCII names keep them, and falls back to the plain quoted `filename`.
 */
export function filenameFromResponse(res: Response): string | null {
  const header = res.headers.get('Content-Disposition')
  if (!header) return null

  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch { /* malformed encoding — fall through to the plain parameter */ }
  }

  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1] : null
}

/** Triggers a browser download for an in-memory blob. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download in some browsers; one tick
  // is enough for the click to have been handed off.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Builds the URL for a books export.
 *
 * `params` carries whatever the caller is currently looking at — the search
 * query, sort and filters — so the exported file matches the view rather
 * than being a fresh unfiltered dump. Paging parameters are deliberately not
 * forwarded: an export covers the whole result set, not the current page.
 */
export function booksExportUrl(
  libraryId: string,
  format: ExportFormat,
  params: {
    q?: string
    sort?: string
    sortDir?: string
    /** Exact-identity filters. Detail pages pass the id of what they show —
     *  a name would match by substring and could sweep in other entities. */
    contributorId?: string
    shelfId?: string
    seriesId?: string
  } = {},
): string {
  const search = new URLSearchParams({ format })
  if (params.q) search.set('q', params.q)
  if (params.sort) search.set('sort', params.sort)
  if (params.sortDir) search.set('sort_dir', params.sortDir)
  if (params.contributorId) search.set('contributor_id', params.contributorId)
  if (params.shelfId) search.set('shelf_id', params.shelfId)
  if (params.seriesId) search.set('series_id', params.seriesId)
  return `/api/v1/libraries/${libraryId}/books/export?${search}`
}

/** Builds the URL for a loans export. */
export function loansExportUrl(
  libraryId: string,
  format: ExportFormat,
  params: {
    search?: string
    includeReturned?: boolean
    /** The status and overdue pills are applied after the fetch, so they have
     *  to be forwarded explicitly or the file will not match the screen. */
    status?: 'active' | 'returned' | 'all'
    overdueOnly?: boolean
  } = {},
): string {
  const query = new URLSearchParams({ format })
  if (params.search) query.set('search', params.search)
  if (params.includeReturned === false) query.set('include_returned', 'false')
  if (params.status && params.status !== 'all') query.set('status', params.status)
  if (params.overdueOnly) query.set('overdue', 'true')
  return `/api/v1/libraries/${libraryId}/loans/export?${query}`
}

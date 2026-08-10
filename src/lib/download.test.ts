// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 fireball1725

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  booksExportUrl,
  EXPORT_FORMATS,
  downloadAuthenticated,
  DownloadError,
  filenameFromResponse,
  loansExportUrl,
  quoteQueryValue,
} from './download'

// The export URL builders are the contract between what the user is looking
// at and what lands in their download folder — a dropped parameter here
// silently hands people a different set of books than the one on screen.
describe('booksExportUrl', () => {
  it('carries the current search and sort', () => {
    const url = booksExportUrl('lib-1', 'csv', { q: 'contributor:"Tite Kubo"', sort: 'author', sortDir: 'desc' })
    const params = new URL(url, 'http://x').searchParams

    expect(url.startsWith('/api/v1/libraries/lib-1/books/export?')).toBe(true)
    expect(params.get('format')).toBe('csv')
    expect(params.get('q')).toBe('contributor:"Tite Kubo"')
    expect(params.get('sort')).toBe('author')
    expect(params.get('sort_dir')).toBe('desc')
  })

  it('omits empty parameters rather than sending blanks', () => {
    const params = new URL(booksExportUrl('lib-1', 'json', { q: '' }), 'http://x').searchParams
    expect(params.get('format')).toBe('json')
    expect(params.has('q')).toBe(false)
    expect(params.has('sort')).toBe(false)
  })

  it('never forwards paging — an export covers the whole result set', () => {
    const url = booksExportUrl('lib-1', 'csv', { q: 'bleach' })
    expect(url).not.toContain('page')
    expect(url).not.toContain('per_page')
  })
})

describe('loansExportUrl', () => {
  it('sends include_returned only when opting out', () => {
    expect(loansExportUrl('lib-1', 'csv', { includeReturned: true })).not.toContain('include_returned')

    const params = new URL(loansExportUrl('lib-1', 'csv', { search: 'sam', includeReturned: false }), 'http://x').searchParams
    expect(params.get('include_returned')).toBe('false')
    expect(params.get('search')).toBe('sam')
  })
})

describe('quoteQueryValue', () => {
  it('quotes multi-word values so the query language keeps them together', () => {
    expect(quoteQueryValue('Tite Kubo')).toBe('"Tite Kubo"')
  })

  it('strips embedded quotes that would end the token early', () => {
    expect(quoteQueryValue('The "Best" Series')).toBe('"The Best Series"')
  })
})

describe('filenameFromResponse', () => {
  const withHeader = (value: string | null) =>
    ({ headers: { get: () => value } }) as unknown as Response

  it('prefers the RFC 6266 UTF-8 name', () => {
    const res = withHeader(`attachment; filename="librarium-books.csv"; filename*=UTF-8''%E5%9B%B3%E6%9B%B8%E9%A4%A8-books.csv`)
    expect(filenameFromResponse(res)).toBe('図書館-books.csv')
  })

  it('falls back to the plain filename', () => {
    expect(filenameFromResponse(withHeader('attachment; filename="my-manga-books.csv"'))).toBe('my-manga-books.csv')
  })

  it('falls back when the encoded name is malformed', () => {
    const res = withHeader(`attachment; filename="ok.csv"; filename*=UTF-8''%E0%A4%A`)
    expect(filenameFromResponse(res)).toBe('ok.csv')
  })

  it('returns null when the header is absent', () => {
    expect(filenameFromResponse(withHeader(null))).toBeNull()
  })
})

describe('downloadAuthenticated', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubDownloadEnvironment() {
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {})
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => {},
    }))
    return { anchor, click }
  }

  it('sends the bearer token and saves the file under the server filename', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('title\nBleach\n', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="my-manga-books.csv"' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { anchor, click } = stubDownloadEnvironment()

    await downloadAuthenticated(async () => 'tok', '/api/v1/libraries/1/books/export', 'fallback.csv')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/libraries/1/books/export', {
      headers: { Authorization: 'Bearer tok' },
    })
    expect(anchor.download).toBe('my-manga-books.csv')
    expect(click).toHaveBeenCalled()
  })

  it('uses the fallback name when the server sends no filename', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
    const { anchor } = stubDownloadEnvironment()

    await downloadAuthenticated(async () => 'tok', '/export', 'library-books.json')

    expect(anchor.download).toBe('library-books.json')
  })

  it('surfaces the API error message instead of downloading an error page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'query too long' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    await expect(downloadAuthenticated(async () => 'tok', '/export', 'x.csv'))
      .rejects.toThrow(new DownloadError(400, 'query too long'))
  })

  it('reports an unreachable server rather than hanging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))

    await expect(downloadAuthenticated(async () => 'tok', '/export', 'x.csv'))
      .rejects.toThrow('Cannot connect to server')
  })
})

// Menu order is a deliberate product decision, not a layout detail: JSON is
// offered first because it keeps the data's shape, and CSV — the more common
// want, but the lossier one — reads as the second choice. A refactor could
// silently flip that, so it is pinned here.
describe('EXPORT_FORMATS', () => {
  it('offers JSON before CSV', () => {
    expect(EXPORT_FORMATS.map(f => f.format)).toEqual(['json', 'csv'])
  })

  it('describes every format it offers', () => {
    for (const { format, label, hint } of EXPORT_FORMATS) {
      expect(label, `${format} needs a label`).toBeTruthy()
      expect(hint, `${format} needs a hint`).toBeTruthy()
    }
  })

  it('does not claim either format is a complete backup', () => {
    // Neither export carries covers, media files or non-primary editions, so
    // a hint promising completeness would be a promise it cannot keep — that
    // is what a database dump is for.
    for (const { hint } of EXPORT_FORMATS) {
      expect(hint.toLowerCase()).not.toMatch(/backup|everything|complete|full detail/)
    }
  })
})

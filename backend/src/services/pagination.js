/**
 * Paging.
 *
 * A list that grows without a stop is a list nobody can use, so the
 * server hands back one page at a time and says how many there are.
 *
 * Paging is opt in: a request without a page number gets the whole list,
 * which is what the smaller callers expect.
 */

/** The most a page may hold. */
export const MAX_PAGE_SIZE = 200

/** The page size when nobody says. */
export const DEFAULT_PAGE_SIZE = 50

/**
 * Read the page a request is asking for.
 */
export function readPage(query = {}) {
  const rawPage = Number(query.page)
  const rawSize = Number(query.pageSize)

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1
      ? Math.min(MAX_PAGE_SIZE, Math.floor(rawSize))
      : DEFAULT_PAGE_SIZE

  return { page, pageSize, offset: (page - 1) * pageSize, paged: Number.isFinite(rawPage) && rawPage >= 1 }
}

/**
 * Put a page of rows into the shape the API answers with.
 */
export function paged(items, total, { page, pageSize }) {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    hasMore: page * pageSize < total
  }
}

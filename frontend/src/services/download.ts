import { API_URL, apiFetch, readError } from './apiClient'

/**
 * Saving a file to the machine.
 *
 * The file comes from the server as a normal download, not as a blob the
 * page builds. A browser handles that in every situation: a page opened
 * from a shortcut, a window without a download shelf, a browser that
 * refuses to start a download the page did not begin itself.
 *
 * A download is a navigation, so it cannot carry the authorisation
 * header. The page asks for a link first, with its header, and then
 * follows the link. The link stands for one file and is good for two
 * minutes.
 */
export async function downloadFromApi(
  kind: 'analysis' | 'report' | 'account' | 'findings',
  id?: string
): Promise<void> {
  const response = await apiFetch('/downloads', {
    method: 'POST',
    body: JSON.stringify({ kind, id }),
  })
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not prepare the download.'))
  }

  const { url } = await response.json()

  // The API is on another address from the page, so the link is followed
  // by the browser rather than fetched.
  const link = document.createElement('a')
  link.href = new URL(url, API_URL).toString()
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

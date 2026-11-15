/**
 * What is on screen while something is being fetched.
 *
 * It is used for the pages that arrive on demand, so the first thing a
 * person sees is never a blank page.
 */
export function Loading({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-10 h-10 border-4 border-accent border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-ink-2">{label}</p>
      </div>
    </div>
  )
}

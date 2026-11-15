import type { ReactNode } from 'react'
import { Search } from 'lucide-react'

/**
 * The row of filters above a list.
 *
 * One bar for the whole product: the search field on the left, the
 * selectors on the right, all on one line where there is room and stacked
 * where there is not.
 */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="glass rounded-[16px] p-4 flex flex-col md:flex-row gap-3 md:items-center">
      {children}
    </div>
  )
}

/**
 * The search field that opens a list.
 *
 * The icon sits inside the field, so the two never drift apart.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
}) {
  return (
    <div className="relative flex-1 min-w-0">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3 pointer-events-none" aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="input-field h-11 !pl-11 w-full"
      />
    </div>
  )
}

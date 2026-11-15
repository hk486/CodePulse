import type { ReactNode } from 'react'

interface PageHeaderProps {
  /** The name of the page. */
  title: string
  /** One line that says what the page is for. */
  description?: ReactNode
  /** The things that can be done here, on the right. */
  actions?: ReactNode
  /** A crumb or a small note that sits above the title. */
  above?: ReactNode
}

/**
 * The heading every page opens with.
 *
 * The pages differ in what they do, not in how they introduce themselves.
 * One shape for all of them: the name, a line that says what the page is
 * for, and the actions on the right. The dashboard and the reports page
 * already work this way, so the rest of the product follows them.
 */
export function PageHeader({ title, description, actions, above }: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
      <div className="min-w-0">
        {above && <div className="mb-3">{above}</div>}
        <h1 className="display mb-2">{title}</h1>
        {description && <p className="text-ink-2 max-w-[68ch]">{description}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-3 shrink-0">{actions}</div>
      )}
    </div>
  )
}

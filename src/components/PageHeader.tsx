import type { ReactNode } from 'react'

/**
 * Every screen opens the same way: a large Outfit title, an optional line
 * above it for context and one below for the summary. No sticky chrome — the
 * content is the chrome.
 */
export function PageHeader({
  title,
  eyebrow,
  subtitle,
  action,
}: {
  title: string
  eyebrow?: string
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="grow">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

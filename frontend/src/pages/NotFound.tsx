/**
 * 404. Previously an unknown URL redirected to "/", which for a signed-in
 * user bounced on to the dashboard -- a mistyped link silently looked like it
 * had worked. Saying what happened is more useful than hiding it.
 */

import { Link } from 'react-router-dom'
import { FileQuestion } from 'lucide-react'

import { ErrorPage } from '@/components/ui'
import { tokens } from '@/lib/api'

export function NotFoundPage() {
  const signedIn = Boolean(tokens.access)
  const home = signedIn ? '/dashboard' : '/'

  return (
    <ErrorPage
      icon={<FileQuestion className="h-7 w-7" aria-hidden />}
      code="404"
      title="Page not found"
      description="That address does not match anything in EasyQuery. It may have been moved, or the link may be incomplete."
      actions={
        <Link
          to={home}
          className="inline-flex h-8 cursor-pointer items-center border border-accent bg-accent px-3 text-sm font-medium text-accent-fg transition-[background-color,transform] duration-fast hover:bg-accent/90 active:scale-[0.97]"
        >
          {signedIn ? 'Back to dashboard' : 'Back to home'}
        </Link>
      }
    />
  )
}

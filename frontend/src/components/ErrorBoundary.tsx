/**
 * Render-error containment.
 *
 * A class component on purpose: catching an error thrown during render is the
 * one thing hooks cannot do, so there is no function-component equivalent of
 * this. Without it a single thrown exception unmounts the entire tree and the
 * user is left on a blank page with no way back.
 *
 * Mounted twice, deliberately. Once around the whole app, to catch anything
 * including the shell, and once around the routed page, so a page that throws
 * leaves the navigation usable and moving to another route recovers.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button, ErrorPage } from '@/components/ui'

/**
 * A lazily-imported chunk that no longer exists. Normal after a deploy: the
 * tab is holding an old index.html that references hashed files which have
 * since been replaced. It reads as a crash but the fix is a reload, so it is
 * worth telling apart from a genuine bug.
 */
const STALE_BUILD = /loading chunk|dynamically imported module|module script failed|failed to fetch/i

function isStaleBuild(error: Error): boolean {
  return STALE_BUILD.test(error.message)
}

interface Props {
  children: ReactNode
  /** When this changes, the boundary clears itself -- pass the current route. */
  resetKey?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only sink available here; the message shown to the
    // user deliberately carries none of this.
    console.error('Unhandled render error', error, info.componentStack)
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  private reset = () => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (isStaleBuild(error)) {
      return (
        <ErrorPage
          icon={<RefreshCw className="h-7 w-7" aria-hidden />}
          code="Update available"
          title="EasyQuery has been updated"
          description="This tab is running an older version whose files are no longer available. Reload to pick up the latest one."
          actions={
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        />
      )
    }

    return (
      <ErrorPage
        icon={<AlertTriangle className="h-7 w-7" aria-hidden />}
        code="Unexpected error"
        title="Something went wrong"
        description="This part of the app stopped responding. Nothing you had already saved is affected. Try again, or reload if it keeps happening."
        detail={error.message}
        actions={
          <>
            <Button variant="primary" onClick={this.reset}>
              Try again
            </Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload
            </Button>
            {/* A plain anchor, not a router Link: if the router itself is what
                threw, a full page load is the reliable way out. */}
            <a
              href="/dashboard"
              className="inline-flex h-8 cursor-pointer items-center border border-transparent px-3 text-sm text-muted transition-colors hover:text-fg"
            >
              Back to dashboard
            </a>
          </>
        }
      />
    )
  }
}

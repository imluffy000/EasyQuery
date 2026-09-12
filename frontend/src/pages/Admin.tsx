import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, Users } from 'lucide-react'

import { AsyncBoundary, Badge, EmptyState, Panel, Stat } from '@/components/ui'
import { api } from '@/lib/api'

export function AdminPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: api.admin.overview,
    retry: false,
  })

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-5xl space-y-3">
        <header className="flex items-start gap-3 border-b border-border pb-3">
          <div className="grid h-8 w-8 place-items-center border border-accent bg-accent/10 text-accent">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <p className="micro">Global operations</p>
            <h1 className="mt-0.5 text-lg font-medium text-fg">Administration</h1>
            <p className="mt-1 text-xs text-muted">User and tenancy metadata. Database credentials and query contents are never displayed.</p>
          </div>
        </header>

        <AsyncBoundary
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          errorMessage="Administrator access is required, or the overview could not be loaded."
        >
          {data && <AdminContent data={data} />}
        </AsyncBoundary>
      </div>
    </div>
  )
}

function AdminContent({ data }: { data: Awaited<ReturnType<typeof api.admin.overview>> }) {
  return (
    <>
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Administration totals">
        <Stat label="Users" value={data.total_users.toLocaleString()} />
        <Stat label="Active" value={data.active_users.toLocaleString()} tone="ok" />
        <Stat label="Workspaces" value={data.total_workspaces.toLocaleString()} />
        <Stat label="Connections" value={data.total_connections.toLocaleString()} />
      </section>

      <Panel title="Users" actions={<span className="micro">Newest first · up to 500</span>}>
        {data.users.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No users yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <caption className="sr-only">EasyQuery users and account status</caption>
              <thead className="border-b border-border bg-elevated text-2xs uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Workspaces</th>
                  <th className="px-3 py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.users.map((user) => (
                  <tr key={user.id} className="hover:bg-elevated/60">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-fg">{user.full_name || 'Unnamed user'}</p>
                      <p className="mt-0.5 font-mono text-2xs text-muted">{user.email}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={user.is_active ? 'ok' : 'danger'}>{user.is_active ? 'active' : 'disabled'}</Badge>
                        {user.is_superuser && <Badge tone="accent">superuser</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-fg">{user.workspace_count}</td>
                    <td className="px-3 py-2.5 font-mono text-2xs text-muted">{new Date(user.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

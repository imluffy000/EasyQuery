import { useQuery } from '@tanstack/react-query'

import { ChatWorkspace } from '@/components/chat/ChatWorkspace'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/useAppStore'

export function ChatPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)

  const { data: memberships = [] } = useQuery({
    queryKey: ['memberships'],
    queryFn: api.auth.memberships,
  })

  // The "Run anyway" control is only offered when the role actually has the
  // permission; the backend enforces it regardless.
  const permissions =
    memberships.find((m) => m.workspace.id === workspaceId)?.permissions ?? []

  return <ChatWorkspace canOverrideCost={permissions.includes('run_expensive_query')} />
}

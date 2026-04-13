import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Star } from "lucide-react"

const DUPE_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "has-linkedin", label: "Has LinkedIn" },
  { value: "no-linkedin", label: "No LinkedIn" },
]

interface DuplicateGroup {
  ids: number[]
  names: string[]
  phones: (string | null)[]
  emails: (string | null)[]
  message_counts: number[]
  profile_pictures: (string | null)[]
  linkedin_urls: (string | null)[]
  organizations: (string | null)[]
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
}

function DuplicateCard({ group, onMerge, onDismiss, onArchive }: {
  group: DuplicateGroup
  onMerge: (keepId: number, mergeIds: number[]) => void
  onDismiss: () => void
  onArchive: (id: number) => void
}) {
  const [starred, setStarred] = useState<Set<number>>(new Set())
  const [archived, setArchived] = useState<Set<number>>(new Set())
  return (
    <div className="border border-border rounded-lg p-4 bg-card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {group.ids.length > 1 ? `Potential duplicate (${group.ids.length} contacts)` : "1 contact remaining"}
        </span>
        {group.ids.length > 1 && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Not duplicates
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {group.ids.map((id, i) => (
          <div key={id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50">
            <Avatar className="h-10 w-10">
              {group.profile_pictures[i] && (
                <AvatarImage src={group.profile_pictures[i]!} />
              )}
              <AvatarFallback className="bg-indigo-600 text-white text-xs">
                {initials(group.names[i])}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <Link to={`/contacts/${id}`} className="font-medium text-sm hover:underline">{group.names[i]}</Link>
              <div className="text-xs text-muted-foreground">
                {[
                  group.organizations[i],
                  group.phones[i],
                  group.emails[i],
                ].filter(Boolean).join(" · ") || "No details"}
              </div>
              {group.linkedin_urls[i] && (
                <div className="text-xs text-blue-400">{group.linkedin_urls[i]}</div>
              )}
            </div>
            <div className="text-right flex items-center gap-2">
              <div className="text-xs text-muted-foreground">{group.message_counts[i]} msgs</div>
              <Toggle
                variant="outline"
                size="sm"
                pressed={starred.has(id)}
                onPressedChange={async (pressed) => {
                  await fetch(`/api/contacts/${id}/stay-in-touch`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ days: pressed ? 90 : null }),
                  })
                  setStarred((prev) => {
                    const next = new Set(prev)
                    pressed ? next.add(id) : next.delete(id)
                    return next
                  })
                }}
              >
                <Star className={`h-4 w-4 ${starred.has(id) ? "fill-yellow-400 text-yellow-400" : ""}`} /> Favorite
              </Toggle>
              <Toggle
                variant="outline"
                size="sm"
                pressed={archived.has(id)}
                onPressedChange={() => {
                  setArchived((prev) => new Set([...prev, id]))
                  onArchive(id)
                }}
              >
                Archive
              </Toggle>
              {group.ids.length > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const mergeIds = group.ids.filter((_, j) => j !== i)
                    onMerge(id, mergeIds)
                  }}
                >
                  Keep this one
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Duplicates() {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(false)

  const loadDuplicates = (refresh = false, offset = 0) => {
    setLoading(true)
    fetch(`/api/duplicates?limit=20&offset=${offset}${refresh ? "&refresh=1" : ""}`)
      .then((r) => r.json())
      .then((data) => {
        setGroups((prev) => offset > 0 ? [...prev, ...data.groups] : data.groups)
        setTotal(data.total)
        setLoading(false)
      })
  }

  useEffect(() => { loadDuplicates() }, [])

  const handleMerge = async (keepId: number, mergeIds: number[]) => {
    setMerging(true)
    await fetch("/api/merge-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepId, mergeIds }),
    })
    setGroups((prev) => prev.filter((g) => !g.ids.includes(keepId)))
    setTotal((t) => t - 1)
    setMerging(false)
    navigate(`/contacts/${keepId}`)
  }

  const handleDismiss = async (group: DuplicateGroup) => {
    await fetch("/api/dismiss-duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: group.ids }),
    })
    setGroups((prev) => prev.filter((g) => g !== group))
    setTotal((t) => t - 1)
  }

  const handleArchive = async (id: number) => {
    await fetch(`/api/contacts/${id}/archive`, { method: "PUT" })
    setGroups((prev) => prev.map((g) => {
      if (!g.ids.includes(id)) return g
      const idx = g.ids.indexOf(id)
      return {
        ...g,
        ids: g.ids.filter((_, i) => i !== idx),
        names: g.names.filter((_, i) => i !== idx),
        phones: g.phones.filter((_, i) => i !== idx),
        emails: g.emails.filter((_, i) => i !== idx),
        message_counts: g.message_counts.filter((_, i) => i !== idx),
        profile_pictures: g.profile_pictures.filter((_, i) => i !== idx),
        linkedin_urls: g.linkedin_urls.filter((_, i) => i !== idx),
        organizations: g.organizations.filter((_, i) => i !== idx),
      }
    }).filter((g) => g.ids.length > 0))
  }

  const [platformFilter, setPlatformFilter] = useState("")

  const filteredGroups = platformFilter
    ? groups.filter((g) => {
        if (platformFilter === "has-linkedin") return g.linkedin_urls.some((u) => u)
        if (platformFilter === "no-linkedin") return g.linkedin_urls.every((u) => !u)
        return true
      })
    : groups

  if (loading && groups.length === 0) return <div className="text-muted-foreground p-4">Finding duplicates...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Duplicate Contacts</h2>
        <div className="flex items-center gap-2">
          <Select value={platformFilter || "all"} onValueChange={(v) => setPlatformFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 w-[140px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DUPE_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={async () => {
            // Dismiss all currently visible groups
            for (const g of filteredGroups) {
              await fetch("/api/dismiss-duplicate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: g.ids }),
              })
            }
            setGroups([])
            setTotal(0)
          }} disabled={loading || filteredGroups.length === 0}>
            Dismiss all ({filteredGroups.length})
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadDuplicates(true)} disabled={loading}>
            {loading ? "Computing..." : "Refresh"}
          </Button>
          <span className="text-sm text-muted-foreground">{total} groups</span>
        </div>
      </div>

      {filteredGroups.length === 0 && !loading && (
        <div className="text-center text-muted-foreground py-8">No duplicates found!</div>
      )}

      <div className="space-y-3">
        {filteredGroups.map((group) => (
          <DuplicateCard
            key={group.ids.join("-")}
            group={group}
            onMerge={handleMerge}
            onDismiss={() => handleDismiss(group)}
            onArchive={handleArchive}
          />
        ))}
      </div>

      {groups.length < total && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => loadDuplicates(false, groups.length)}
          disabled={loading}
        >
          {loading ? "Loading..." : `Load more (${groups.length}/${total})`}
        </Button>
      )}

      {merging && <div className="text-sm text-muted-foreground">Merging...</div>}
    </div>
  )
}

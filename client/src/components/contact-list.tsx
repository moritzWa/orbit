import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Star } from "lucide-react"
import type { Contact } from "@/types"

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never"
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

const colors = [
  "bg-indigo-600", "bg-violet-600", "bg-blue-600", "bg-cyan-600", "bg-emerald-600",
  "bg-amber-600", "bg-red-600", "bg-pink-600", "bg-purple-600", "bg-teal-600",
]

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

interface ContactListProps {
  contacts: Contact[]
  onSelect: (contact: Contact) => void
  onArchive?: (id: number) => void
  onToggleStar?: (id: number, current: number | null) => void
  view?: "list" | "grid"
  gridRef?: React.RefObject<HTMLDivElement | null>
  focusedIndex?: number
}

export function ContactList({ contacts, onSelect, onArchive, onToggleStar, view = "grid", gridRef, focusedIndex = -1 }: ContactListProps) {
  if (view === "grid") {
    return (
      <div ref={gridRef} className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {contacts.map((c, i) => (
          <div
            key={c.id}
            className={`relative group rounded-lg border bg-card p-3 hover:bg-muted/50 transition-colors cursor-pointer ${i === focusedIndex ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
            onClick={() => onSelect(c)}
          >
            {onToggleStar && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleStar(c.id, c.stay_in_touch_days) }}
                className={`absolute top-2 right-2 ${c.stay_in_touch_days ? "text-yellow-400" : "text-muted-foreground/20 opacity-0 group-hover:opacity-100"}`}
              >
                <Star className={`h-4 w-4 ${c.stay_in_touch_days ? "fill-yellow-400" : ""}`} />
              </button>
            )}
            {onArchive && (
              <button
                onClick={(e) => { e.stopPropagation(); onArchive(c.id) }}
                className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-muted-foreground hover:text-foreground"
              >
                Archive
              </button>
            )}
            <div className="flex flex-col items-center text-center gap-2">
              <Avatar className="h-14 w-14">
                {c.profile_picture_url && (
                  <AvatarImage src={c.profile_picture_url} alt={c.display_name} />
                )}
                <AvatarFallback className={`${avatarColor(c.display_name)} text-white text-sm`}>
                  {initials(c.display_name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 w-full">
                <div className="font-medium text-xs truncate">{c.display_name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {timeAgo(c.last_contacted)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      {contacts.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors group"
        >
          {onToggleStar && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleStar(c.id, c.stay_in_touch_days) }}
              className={`shrink-0 ${c.stay_in_touch_days ? "text-yellow-400" : "text-muted-foreground/20 hover:text-yellow-400/50"}`}
            >
              <Star className={`h-4 w-4 ${c.stay_in_touch_days ? "fill-yellow-400" : ""}`} />
            </button>
          )}
          <button
            onClick={() => onSelect(c)}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
          >
            <Avatar className="h-10 w-10 shrink-0">
              {c.profile_picture_url && (
                <AvatarImage src={c.profile_picture_url} alt={c.display_name} />
              )}
              <AvatarFallback className={`${avatarColor(c.display_name)} text-white text-xs`}>
                {initials(c.display_name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{c.display_name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {c.linkedin_headline || c.organization || c.phones || ""}
              </div>
            </div>
          </button>
          <div className="text-right shrink-0 flex items-center gap-2">
            {onArchive && (
              <button
                onClick={(e) => { e.stopPropagation(); onArchive(c.id) }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                title="Archive"
              >
                Archive
              </button>
            )}
            <div>
              <Badge variant="secondary" className="text-xs">
                {c.message_count}
              </Badge>
              <div className="text-[11px] text-muted-foreground mt-1">
                {timeAgo(c.last_contacted)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

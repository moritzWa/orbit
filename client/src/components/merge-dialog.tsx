import { useEffect, useState, useRef } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import type { Contact } from "@/types"

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
}

interface MergeDialogProps {
  contact: Contact
  open: boolean
  onClose: () => void
  onMerged: () => void
}

export function MergeDialog({ contact, open, onClose, onMerged }: MergeDialogProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Contact[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (open) {
      setQuery("")
      setResults([])
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const search = (q: string) => {
    setQuery(q)
    clearTimeout(searchTimeout.current)
    if (!q.trim()) { setResults([]); return }
    searchTimeout.current = setTimeout(() => {
      setLoading(true)
      fetch(`/api/contacts?q=${encodeURIComponent(q)}&limit=10`)
        .then((r) => r.json())
        .then((data) => {
          // Filter out the current contact
          setResults(data.contacts.filter((c: Contact) => c.id !== contact.id))
          setSelectedIndex(0)
          setLoading(false)
        })
    }, 200)
  }

  const merge = async (target: Contact) => {
    // Merge current contact into target (target keeps, current gets deleted)
    await fetch("/api/merge-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepId: target.id, mergeIds: [contact.id] }),
    })
    toast(`Merged ${contact.display_name} into ${target.display_name}`)
    onClose()
    onMerged()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault()
      merge(results[selectedIndex])
    } else if (e.key === "Escape") {
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="p-0 gap-0 max-w-md">
        <div className="p-3 border-b border-border">
          <p className="text-xs text-muted-foreground mb-2">
            Merge <strong>{contact.display_name}</strong> into...
          </p>
          <Input
            ref={inputRef}
            placeholder="Search contacts..."
            value={query}
            onChange={(e) => search(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-9"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {loading && <div className="p-3 text-xs text-muted-foreground">Searching...</div>}
          {results.map((c, i) => (
            <button
              key={c.id}
              onClick={() => merge(c)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm ${
                i === selectedIndex ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              <Avatar className="h-8 w-8 shrink-0">
                {c.profile_picture_url && <AvatarImage src={c.profile_picture_url} />}
                <AvatarFallback className="text-xs bg-indigo-600 text-white">{initials(c.display_name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="font-medium truncate">{c.display_name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {c.linkedin_headline || c.organization || `${c.message_count} msgs`}
                </div>
              </div>
            </button>
          ))}
          {query && !loading && results.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground">No contacts found</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

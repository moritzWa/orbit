import { useEffect, useState, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Link } from "react-router-dom"
import { Users, X } from "lucide-react"
import type { Contact } from "@/types"

const CONNECTION_TYPES = [
  "close-friend", "friend", "acquaintance", "introduced-by", "roommate", "dated", "colleague", "mentor"
]

interface Connection {
  id: number
  contact_id: number
  display_name: string
  profile_picture_url: string | null
  type: string
}

export function ConnectionPicker({ contactId }: { contactId: number }) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Contact[]>([])
  const [selectedType, setSelectedType] = useState("friend")
  const [loading, setLoading] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/contacts/${contactId}/connections`)
      .then((r) => r.json())
      .then((d) => setConnections(d.connections ?? []))
  }, [contactId])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const search = (q: string) => {
    setQuery(q)
    clearTimeout(searchTimeout.current)
    if (!q.trim()) { setResults([]); return }
    searchTimeout.current = setTimeout(() => {
      setLoading(true)
      fetch(`/api/contacts?q=${encodeURIComponent(q)}&limit=8`)
        .then((r) => r.json())
        .then((data) => {
          setResults(data.contacts.filter((c: Contact) => c.id !== contactId))
          setLoading(false)
        })
    }, 200)
  }

  const addConnection = async (targetId: number) => {
    await fetch(`/api/contacts/${contactId}/connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId, type: selectedType }),
    })
    setOpen(false)
    setQuery("")
    setResults([])
    fetch(`/api/contacts/${contactId}/connections`)
      .then((r) => r.json())
      .then((d) => setConnections(d.connections ?? []))
  }

  const removeConnection = async (connId: number) => {
    await fetch(`/api/contacts/${contactId}/connections/${connId}`, { method: "DELETE" })
    setConnections((prev) => prev.filter((c) => c.id !== connId))
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {connections.map((conn) => (
        <Badge key={conn.id} variant="secondary" className="text-xs gap-1 pr-1">
          <Link to={`/contacts/${conn.contact_id}`} className="hover:underline">
            {conn.display_name}
          </Link>
          <span className="text-muted-foreground">({conn.type})</span>
          <button onClick={() => removeConnection(conn.id)} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          data-connection-trigger
          className="inline-flex items-center h-6 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
        >
          <Users className="h-3 w-3 mr-1" /> + connection
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <div className="flex gap-2 mb-2">
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="h-7 text-xs w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONNECTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            ref={inputRef}
            placeholder="Search contact..."
            value={query}
            onChange={(e) => search(e.target.value)}
            className="text-sm h-8 mb-2"
          />
          <div className="max-h-48 overflow-y-auto">
            {loading && <div className="text-xs text-muted-foreground p-2">Searching...</div>}
            {results.map((c) => (
              <button
                key={c.id}
                onClick={() => addConnection(c.id)}
                className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted truncate"
              >
                {c.display_name}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

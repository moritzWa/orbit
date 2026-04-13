import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Contact } from "@/types"

function isValidUrl(s: string): boolean {
  try {
    const url = new URL(s.trim())
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

interface ImageResult {
  title: string
  imageUrl: string
  thumbnailUrl: string
  source: string
}

function PhotoCard({
  contact,
  improvedQuery,
  onDone,
}: {
  contact: Contact
  improvedQuery?: string
  onDone: () => void
}) {
  const [images, setImages] = useState<ImageResult[]>([])
  const [loading, setLoading] = useState(false)
  const [extraContext, setExtraContext] = useState("")
  const [pasteUrl, setPasteUrl] = useState("")
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [saved, setSaved] = useState(false)
  const [currentQuery, setCurrentQuery] = useState("")
  const [error, setError] = useState("")

  const doSearch = (query: string) => {
    setCurrentQuery(query)
    setLoading(true)
    setError("")
    fetch(`/api/image-search?q=${encodeURIComponent(query)}`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) {
          setError(`API error ${r.status}: ${data.detail || data.error || "unknown"}`)
          setImages([])
        } else {
          setImages(data.images ?? [])
          if ((data.images ?? []).length === 0) {
            setError(`Serper returned 0 images for "${query}"`)
          }
        }
        setLoading(false)
      })
      .catch((e) => {
        setError(`Fetch failed: ${e.message}`)
        setLoading(false)
      })
  }

  const [recentMsgs, setRecentMsgs] = useState<Array<{ text: string | null; is_from_me: number }>>([])
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    fetch(`/api/contacts/${contact.id}/messages?limit=2`)
      .then((r) => r.json())
      .then(setRecentMsgs)
      .catch(() => {})
  }, [contact.id])

  useEffect(() => {
    // If we have an improved query, use it (only search once)
    if (improvedQuery && !hasSearched) {
      doSearch(improvedQuery)
      setHasSearched(true)
    }
  }, [improvedQuery])

  useEffect(() => {
    // If no improved query is coming (undefined means LLM is done and didn't return one),
    // search with just the name. But wait a tick for improvedQuery to potentially arrive.
    if (!hasSearched && improvedQuery === undefined) {
      const timer = setTimeout(() => {
        if (!hasSearched) {
          doSearch(contact.display_name)
          setHasSearched(true)
        }
      }, 2000) // wait 2s for LLM, then fallback to name
      return () => clearTimeout(timer)
    }
  }, [contact.display_name, hasSearched, improvedQuery])

  const selectImage = (url: string) => {
    fetch(`/api/contacts/${contact.id}/photo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then(() => {
      setSaved(true)
      setTimeout(onDone, 500)
    })
  }

  const refineSearch = () => {
    if (extraContext.trim()) {
      doSearch(`${contact.display_name} ${extraContext.trim()}`)
    }
  }

  if (saved) {
    return (
      <div className="border border-border rounded-lg p-4 bg-card text-center text-green-400">
        Saved!
      </div>
    )
  }

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0 flex-1">
          <Link to={`/contacts/${contact.id}`} className="font-medium hover:underline">
            {contact.display_name}
          </Link>
          <div className="text-xs text-muted-foreground">
            {contact.linkedin_headline || contact.organization || ""}
            {contact.message_count > 0 && ` · ${contact.message_count} msgs`}
          </div>
          {currentQuery !== contact.display_name && (
            <div className="text-xs text-blue-400 mt-1">
              Search: "{currentQuery}"
            </div>
          )}
          {recentMsgs.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {recentMsgs.map((m, i) => (
                <div key={i} className="text-xs text-muted-foreground truncate">
                  <span className="text-muted-foreground/60">{m.is_from_me ? "You: " : ""}</span>
                  {m.text || "(attachment)"}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => {
            fetch(`/api/contacts/${contact.id}/archive`, { method: "PUT" })
            onDone()
          }}>
            Archive
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowUrlInput(!showUrlInput)}
          >
            Paste URL
          </Button>
          <Button variant="ghost" size="sm" onClick={() => {
            fetch(`/api/contacts/${contact.id}/skip-photo`, { method: "PUT" })
            onDone()
          }}>
            Skip
          </Button>
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <Input
          placeholder="Add context: e.g. Stanford, Instagram, designer..."
          value={extraContext}
          onChange={(e) => setExtraContext(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && refineSearch()}
          className="flex-1 text-sm"
        />
        <Button size="sm" onClick={refineSearch} disabled={!extraContext.trim()}>
          Search
        </Button>
      </div>

      {showUrlInput && (
        <div className="flex gap-2 mb-3">
          <Input
            placeholder="Paste image URL..."
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValidUrl(pasteUrl)) {
                selectImage(pasteUrl.trim())
              }
            }}
            className="flex-1 text-sm"
            autoFocus
          />
          <Button
            size="sm"
            disabled={!isValidUrl(pasteUrl)}
            onClick={() => isValidUrl(pasteUrl) && selectImage(pasteUrl.trim())}
        >
          Save URL
        </Button>
      </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Searching...
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => selectImage(img.imageUrl)}
              className="aspect-square rounded-md overflow-hidden border border-border hover:border-primary transition-colors cursor-pointer bg-muted"
            >
              <img
                src={img.thumbnailUrl || img.imageUrl}
                alt={img.title}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = "none"
                }}
              />
            </button>
          ))}
          {images.length === 0 && (
            <div className="col-span-3 text-sm text-muted-foreground py-4 text-center">
              {error ? (
                <span className="text-red-400">{error}</span>
              ) : (
                "No images found. Try adding context."
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function PhotoPicker() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set())
  const [improvedQueries, setImprovedQueries] = useState<Record<number, string>>({})
  const [improvingQueries, setImprovingQueries] = useState(false)

  useEffect(() => {
    fetch("/api/contacts?sort=messages&needs_photo=1&limit=50")
      .then((r) => r.json())
      .then((data) => {
        setContacts(data.contacts)
        setLoading(false)

        // Improve search queries only for the first 5 visible
        const ids = data.contacts.slice(0, 5).map((c: Contact) => c.id)
        if (ids.length > 0) {
          setImprovingQueries(true)
          fetch("/api/improve-search-queries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contactIds: ids }),
          })
            .then((r) => r.json())
            .then((data) => {
              const map: Record<number, string> = {}
              for (const q of data.queries ?? []) {
                map[q.id] = q.query
              }
              setImprovedQueries(map)
              setImprovingQueries(false)
            })
            .catch(() => setImprovingQueries(false))
        }
      })
  }, [])

  const remaining = contacts.filter((c) => !doneIds.has(c.id))

  if (loading) {
    return <div className="text-muted-foreground p-4">Loading contacts...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Profile Pictures</h2>
        <div className="flex items-center gap-2">
          {improvingQueries && (
            <span className="text-xs text-muted-foreground">Improving search queries...</span>
          )}
          <span className="text-sm text-muted-foreground">
            {remaining.length} remaining
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {remaining.slice(0, 5).map((contact) => (
          <PhotoCard
            key={contact.id}
            contact={contact}
            improvedQuery={improvedQueries[contact.id]}
            onDone={() =>
              setDoneIds((prev) => new Set([...prev, contact.id]))
            }
          />
        ))}
      </div>

      {remaining.length === 0 && (
        <div className="text-center text-muted-foreground py-8">
          All done! No more contacts need photos.
        </div>
      )}
    </div>
  )
}

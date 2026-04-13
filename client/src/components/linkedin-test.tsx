import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"

interface EnrichContact {
  id: number
  display_name: string
  linkedin_url: string
  linkedin_headline: string | null
  profile_picture_url: string | null
  message_count: number
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
}

function TestCard({ contact, onEnriched }: { contact: EnrichContact; onEnriched: (c: EnrichContact) => void }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [result, setResult] = useState<string>("")

  const fetchProfile = async () => {
    setStatus("loading")
    try {
      const res = await fetch(`/api/enrich-contact/${contact.id}`, { method: "POST" })
      const data = await res.json()
      if (data.ok) {
        setStatus("done")
        setResult(data.headline || "Enriched!")
        onEnriched({ ...contact, profile_picture_url: data.profile_picture_url, linkedin_headline: data.headline })
      } else {
        setStatus("error")
        setResult(data.error || "Failed")
      }
    } catch (e) {
      setStatus("error")
      setResult((e as Error).message)
    }
  }

  return (
    <div className="flex items-center gap-3 p-3 border border-border rounded-lg bg-card">
      <Avatar className="h-12 w-12">
        {contact.profile_picture_url && <AvatarImage src={contact.profile_picture_url} />}
        <AvatarFallback className="bg-indigo-600 text-white text-xs">{initials(contact.display_name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{contact.display_name}</div>
        <div className="text-xs text-muted-foreground">{contact.linkedin_headline || ""} · {contact.message_count} msgs</div>
        <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className="text-xs text-blue-400">{contact.linkedin_url}</a>
        {result && <div className={`text-xs mt-1 ${status === "error" ? "text-red-400" : "text-green-400"}`}>{result}</div>}
      </div>
      <Button size="sm" onClick={fetchProfile} disabled={status === "loading" || status === "done"}>
        {status === "loading" ? "Fetching..." : status === "done" ? "Done" : "Fetch"}
      </Button>
    </div>
  )
}

export function LinkedInTest() {
  const [contacts, setContacts] = useState<EnrichContact[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/contacts?sort=messages&limit=10&has_linkedin=1&not_enriched=1&needs_photo=1")
      .then((r) => r.json())
      .then((data) => {
        setContacts(data.contacts)
        setLoading(false)
      })
  }, [])

  if (loading) return <div className="text-muted-foreground p-4">Loading...</div>

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Test LinkedIn Enrichment</h2>
      <p className="text-sm text-muted-foreground">Click "Fetch" to pull LinkedIn profile data via RapidAPI (1 credit each)</p>
      <div className="space-y-2">
        {contacts.map((c) => (
          <TestCard
            key={c.id}
            contact={c}
            onEnriched={(updated) => setContacts((prev) => prev.map((p) => p.id === updated.id ? { ...p, ...updated } : p))}
          />
        ))}
      </div>
    </div>
  )
}

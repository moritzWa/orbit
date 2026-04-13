import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tags, X } from "lucide-react"

interface TagPickerProps {
  contactId: number
}

export function TagPicker({ contactId }: TagPickerProps) {
  const [tags, setTags] = useState<string[]>([])
  const [allTags, setAllTags] = useState<Array<{ tag: string; count: number }>>([])
  const [input, setInput] = useState("")
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch(`/api/contacts/${contactId}/tags`).then((r) => r.json()).then((d) => setTags(d.tags))
    fetch("/api/tags").then((r) => r.json()).then((d) => setAllTags(d.tags))
  }, [contactId])

  const saveTags = async (newTags: string[]) => {
    setTags(newTags)
    await fetch(`/api/contacts/${contactId}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: newTags }),
    })
  }

  const addTag = (tag: string) => {
    const normalized = tag.trim().toLowerCase()
    if (normalized && !tags.includes(normalized)) {
      saveTags([...tags, normalized])
    }
    setInput("")
  }

  const removeTag = (tag: string) => {
    saveTags(tags.filter((t) => t !== tag))
  }

  const suggestions = allTags
    .filter((t) => !tags.includes(t.tag) && t.tag.includes(input.toLowerCase()))
    .slice(0, 8)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="text-xs gap-1 pr-1">
          {tag}
          <button onClick={() => removeTag(tag)} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          data-tag-trigger
          className="inline-flex items-center h-6 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
        >
          <Tags className="h-3 w-3 mr-1" /> + tag
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <Input
            placeholder="Add tag..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                addTag(input)
                setOpen(false)
              }
            }}
            className="text-sm h-8 mb-2"
            autoFocus
          />
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.map((s) => (
                <button
                  key={s.tag}
                  onClick={() => { addTag(s.tag); setOpen(false) }}
                  className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground"
                >
                  {s.tag} ({s.count})
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

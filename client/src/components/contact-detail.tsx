import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { ContactHeader } from '@/components/contact-header';
import { MessageList } from '@/components/message-list';
import { TagPicker } from '@/components/tag-picker';
import { ConnectionPicker } from '@/components/connection-picker';
import { MergeDialog } from '@/components/merge-dialog';
import type { Contact, Message } from '@/types';

interface ContactDetailProps {
  contact: Contact;
  onBack: () => void;
}

export function ContactDetail({
  contact: initialContact,
  onBack,
}: ContactDetailProps) {
  const [contact, setContact] = useState(initialContact);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showPhotoSearch, setShowPhotoSearch] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [photoResults, setPhotoResults] = useState<Array<{imageUrl: string; thumbnailUrl: string; title: string}>>([]);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoExtraContext, setPhotoExtraContext] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [editForm, setEditForm] = useState({
    display_name: contact.display_name,
    organization: contact.organization || '',
    linkedin_url: contact.linkedin_url || '',
  });

  const saveEdit = async () => {
    const parts = editForm.display_name.trim().split(' ');
    const first_name = parts[0];
    const last_name = parts.slice(1).join(' ') || null;
    await fetch(`/api/contacts/${contact.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: editForm.display_name.trim(),
        first_name,
        last_name,
        organization: editForm.organization || null,
        linkedin_url: editForm.linkedin_url || null,
      }),
    });
    setContact({
      ...contact,
      display_name: editForm.display_name.trim(),
      organization: editForm.organization || null,
      linkedin_url: editForm.linkedin_url || null,
    });
    setEditing(false);
  };

  const updateStayInTouch = async (days: number | null) => {
    await fetch(`/api/contacts/${contact.id}/stay-in-touch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days }),
    });
    setContact({
      ...contact,
      stay_in_touch_days: days,
    } as typeof contact);
  };

  // Vim-like keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        // Enter in notes textarea removes focus
        if (e.key === "Enter" && tag === "TEXTAREA" && !e.shiftKey) {
          (e.target as HTMLElement).blur();
          e.preventDefault();
        }
        return;
      }

      if (e.key === "e") {
        e.preventDefault();
        setEditing(true);
      } else if (e.key === "n") {
        e.preventDefault();
        const notes = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Notes"]');
        notes?.focus();
      } else if (e.key === "a") {
        e.preventDefault();
        fetch(`/api/contacts/${contact.id}/archive`, { method: "PUT" }).then(() => {
          toast(`Archived ${contact.display_name}`);
          onBack();
        });
      } else if (e.key === "s") {
        e.preventDefault();
        const newDays = contact.stay_in_touch_days ? null : 90;
        updateStayInTouch(newDays);
        toast(newDays ? `★ ${contact.display_name} added to favorites` : `${contact.display_name} removed from favorites`);
      } else if (e.key === "t") {
        e.preventDefault();
        const tagBtn = document.querySelector<HTMLButtonElement>('[data-tag-trigger]');
        tagBtn?.click();
      } else if (e.key === "m") {
        e.preventDefault();
        setShowMerge(true);
      } else if (e.key === "c") {
        e.preventDefault();
        const btn = document.querySelector<HTMLButtonElement>('[data-connection-trigger]');
        btn?.click();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [contact.id, contact.stay_in_touch_days]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/contacts/${contact.id}/messages?limit=100`)
      .then((r) => r.json())
      .then((data) => { setMessages(data); setLoading(false); });
    fetch(`/api/contacts/${contact.id}/tags`)
      .then((r) => r.json())
      .then((data) => setTags(data.tags));
  }, [contact.id]);

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="shrink-0 space-y-4 pb-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back
        </Button>

        <ContactHeader
          contact={contact}
          tags={tags}
          editing={editing}
          editForm={editForm}
          onEditFormChange={setEditForm}
          onStartEdit={() => setEditing(true)}
          onSaveEdit={saveEdit}
          onCancelEdit={() => setEditing(false)}
          onArchive={async () => {
            await fetch(`/api/contacts/${contact.id}/archive`, {
              method: 'PUT',
            });
            onBack();
          }}
          onToggleStar={() =>
            updateStayInTouch(contact.stay_in_touch_days ? null : 90)
          }
          onSetStayInTouchDays={(days) => updateStayInTouch(days)}
          onFindPhoto={() => {
            setShowPhotoSearch(true);
            setPhotoLoading(true);
            const query = [contact.display_name, contact.linkedin_headline || contact.organization || ""].filter(Boolean).join(" ");
            fetch(`/api/image-search?q=${encodeURIComponent(query)}`)
              .then((r) => r.json())
              .then((data) => { setPhotoResults(data.images ?? []); setPhotoLoading(false); })
              .catch(() => setPhotoLoading(false));
          }}
        />

        {showPhotoSearch && (
          <div className="border border-border rounded-lg p-3 bg-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Select a photo</span>
              <button onClick={() => setShowPhotoSearch(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add context: e.g. Stanford, Instagram..."
                value={photoExtraContext}
                onChange={(e) => setPhotoExtraContext(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && photoExtraContext.trim()) {
                    e.stopPropagation();
                    setPhotoLoading(true);
                    const query = `${contact.display_name} ${photoExtraContext.trim()}`;
                    fetch(`/api/image-search?q=${encodeURIComponent(query)}`)
                      .then((r) => r.json())
                      .then((data) => { setPhotoResults(data.images ?? []); setPhotoLoading(false); })
                      .catch(() => setPhotoLoading(false));
                  }
                }}
                className="flex-1 text-sm h-8"
              />
            </div>
            {photoLoading ? (
              <div className="text-xs text-muted-foreground py-4 text-center">Searching...</div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {photoResults.map((img, i) => (
                  <button
                    key={i}
                    onClick={async () => {
                      await fetch(`/api/contacts/${contact.id}/photo`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ url: img.imageUrl }),
                      });
                      setContact({ ...contact, profile_picture_url: `/photos/${contact.id}.jpg` } as typeof contact);
                      setShowPhotoSearch(false);
                    }}
                    className="aspect-square rounded-md overflow-hidden border border-border hover:border-primary transition-colors bg-muted"
                  >
                    <img src={img.thumbnailUrl || img.imageUrl} alt={img.title} className="w-full h-full object-cover" loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <textarea
          className="w-full text-sm bg-muted/30 border border-border rounded-md p-2 resize-none focus:outline-none focus:border-foreground/30 placeholder:text-muted-foreground/50"
          placeholder="Notes..."
          rows={2}
          defaultValue={contact.notes ?? ''}
          onBlur={async (e) => {
            const notes = e.target.value.trim();
            if (notes !== (contact.notes ?? '')) {
              await fetch(`/api/contacts/${contact.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: notes || null }),
              });
              setContact({ ...contact, notes } as typeof contact);
            }
          }}
        />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowEventForm(!showEventForm)}
          >
            + Met in person
          </Button>
          {showEventForm && (
            <div className="flex items-center gap-2">
              <select
                id="event-time"
                className="h-8 text-xs rounded-md border border-border bg-background px-2"
                defaultValue="7"
              >
                <option value="0">Today</option>
                <option value="7">~1 week ago</option>
                <option value="14">~2 weeks ago</option>
                <option value="21">~3 weeks ago</option>
                <option value="30">~1 month ago</option>
                <option value="60">~2 months ago</option>
              </select>
              <Button
                size="sm"
                onClick={async () => {
                  const daysAgo = parseInt(
                    (document.getElementById('event-time') as HTMLSelectElement)
                      .value
                  );
                  await fetch(`/api/contacts/${contact.id}/manual-event`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: '🤝 Met in person', daysAgo }),
                  });
                  setShowEventForm(false);
                  // Reload messages
                  fetch(`/api/contacts/${contact.id}/messages?limit=100`)
                    .then((r) => r.json())
                    .then(setMessages);
                }}
              >
                Save
              </Button>
            </div>
          )}

          <TagPicker contactId={contact.id} />
          <ConnectionPicker contactId={contact.id} />
        </div>

        <Separator />
        <h3 className="text-sm font-medium text-muted-foreground">
          Recent Messages
        </h3>
      </div>

      {/* Scrollable messages */}
      <MessageList messages={messages} loading={loading} />

      <MergeDialog
        contact={contact}
        open={showMerge}
        onClose={() => setShowMerge(false)}
        onMerged={() => onBack()}
      />
    </div>
  );
}

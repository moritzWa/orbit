import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Archive, Star } from 'lucide-react';
import type { Contact } from '@/types';

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

interface ContactHeaderProps {
  contact: Contact;
  editing: boolean;
  editForm: {
    display_name: string;
    organization: string;
    linkedin_url: string;
  };
  onEditFormChange: (form: {
    display_name: string;
    organization: string;
    linkedin_url: string;
  }) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onArchive: () => void;
  onToggleStar: () => void;
  onSetStayInTouchDays: (days: number) => void;
  onFindPhoto?: () => void;
  tags?: string[];
}

export function ContactHeader({
  contact,
  editing,
  editForm,
  onEditFormChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onArchive,
  onToggleStar,
  onSetStayInTouchDays,
  onFindPhoto,
  tags = [],
}: ContactHeaderProps) {
  return (
    <div className="flex gap-4 items-start">
      <div className="relative group shrink-0">
        <Avatar className="h-16 w-16">
          {contact.profile_picture_url && (
            <AvatarImage src={contact.profile_picture_url} alt={contact.display_name} />
          )}
          <AvatarFallback className="bg-indigo-600 text-white text-xl">
            {initials(contact.display_name)}
          </AvatarFallback>
        </Avatar>
        {onFindPhoto && (
          <button
            onClick={onFindPhoto}
            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs"
          >
            {contact.profile_picture_url ? "Change" : "Find"}
          </button>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        {editing ? (
          <div className="space-y-2">
            <input
              className="text-xl font-semibold bg-transparent border-b border-foreground/20 focus:border-foreground outline-none w-full"
              value={editForm.display_name}
              onChange={(e) =>
                onEditFormChange({ ...editForm, display_name: e.target.value })
              }
              autoFocus
            />
            <input
              className="text-sm text-muted-foreground bg-transparent border-b border-foreground/20 focus:border-foreground outline-none w-full"
              placeholder="Organization / headline"
              value={editForm.organization}
              onChange={(e) =>
                onEditFormChange({ ...editForm, organization: e.target.value })
              }
            />
            <input
              className="text-sm text-muted-foreground bg-transparent border-b border-foreground/20 focus:border-foreground outline-none w-full"
              placeholder="LinkedIn URL"
              value={editForm.linkedin_url}
              onChange={(e) =>
                onEditFormChange({ ...editForm, linkedin_url: e.target.value })
              }
            />
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={onSaveEdit}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <h2
              className="text-xl font-semibold cursor-pointer hover:text-foreground/80"
              onClick={onStartEdit}
            >
              {contact.display_name}{' '}
              <span className="text-xs text-muted-foreground font-normal">
                edit
              </span>
            </h2>
            {(contact.linkedin_headline || contact.organization) && (
              <p className="text-sm text-muted-foreground">
                {contact.linkedin_headline || contact.organization}
              </p>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2 pt-1 justify-start items-center">
          {contact.phones && (
            <Badge variant="outline" className="text-xs">
              {contact.phones}
            </Badge>
          )}
          {contact.emails && (
            <Badge variant="outline" className="text-xs">
              {contact.emails}
            </Badge>
          )}
          {contact.linkedin_url && (
            <a href={contact.linkedin_url} target="_blank" rel="noreferrer">
              <Badge variant="outline" className="text-xs hover:bg-muted">
                LinkedIn ↗
              </Badge>
            </a>
          )}
          {contact.x_username && (
            <a
              href={`https://x.com/${contact.x_username}`}
              target="_blank"
              rel="noreferrer"
            >
              <Badge variant="outline" className="text-xs hover:bg-muted">
                X ↗
              </Badge>
            </a>
          )}
          {contact.apple_contact_uuid && (
            <button onClick={() => { window.location.href = `addressbook://${contact.apple_contact_uuid}`; }}>
              <Badge variant="outline" className="text-xs hover:bg-muted">
                Contacts ↗
              </Badge>
            </button>
          )}
          {contact.phones && (
            <>
              <a href={`imessage://${contact.phones.split(',')[0]}`}>
                <Badge variant="outline" className="text-xs hover:bg-muted">
                  iMessage ↗
                </Badge>
              </a>
              {contact.beeper_thread_url ? (
                <a href={contact.beeper_thread_url}>
                  <Badge variant="outline" className="text-xs hover:bg-muted">Beeper ↗</Badge>
                </a>
              ) : (
                <a href={`beeper://compose/imessage/${contact.phones.split(',')[0]}`}>
                  <Badge variant="outline" className="text-xs hover:bg-muted">Beeper (new) ↗</Badge>
                </a>
              )}
            </>
          )}
        </div>
        {contact.linkedin_location && (
          <p className="text-xs text-muted-foreground pt-1">
            📍 {contact.linkedin_location}
          </p>
        )}
        <p className="text-xs text-muted-foreground pt-1">
          {contact.message_count} messages · First:{' '}
          {contact.first_contacted?.slice(0, 10) ?? '?'} · Last:{' '}
          {timeAgo(contact.last_contacted)}
          {tags.includes('x-mutual') && ' · X mutual'}
          {tags.includes('x-following') && !tags.includes('x-mutual') && ' · X following'}
          {tags.includes('x-follower') && !tags.includes('x-mutual') && !tags.includes('x-following') && ' · X follower'}
        </p>
        <div className="flex items-center gap-2 pt-2">
          <Toggle
            variant="outline"
            size="sm"
            pressed={false}
            onPressedChange={onArchive}
          >
            <Archive className="mr-1 h-4 w-4" /> Archive
          </Toggle>
          <Toggle
            variant="outline"
            size="sm"
            pressed={!!contact.stay_in_touch_days}
            onPressedChange={onToggleStar}
          >
            <Star
              className={`mr-1 h-4 w-4 ${contact.stay_in_touch_days ? 'fill-yellow-400 text-yellow-400' : ''}`}
            />
            Favorite
          </Toggle>
          {contact.stay_in_touch_days && (
            <ToggleGroup
              type="single"
              size="sm"
              value={String(contact.stay_in_touch_days)}
              onValueChange={(val) => {
                if (!val) return;
                onSetStayInTouchDays(parseInt(val));
              }}
            >
              <ToggleGroupItem value="45" className="text-xs h-7 px-2">
                6w
              </ToggleGroupItem>
              <ToggleGroupItem value="90" className="text-xs h-7 px-2">
                3m
              </ToggleGroupItem>
              <ToggleGroupItem value="180" className="text-xs h-7 px-2">
                6m
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
      </div>
    </div>
  );
}

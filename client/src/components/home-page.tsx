import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface SyncStatus {
  source: string;
  last_ran: string | null;
  last_count: number;
}

const SOURCE_LABELS: Record<string, string> = {
  imessage: 'iMessage',
  whatsapp: 'WhatsApp',
  apple_contacts: 'Apple Contacts',
  linkedin: 'LinkedIn CSV',
  call_history: 'Call History',
  x: 'X/Twitter Followers',
  twitter_dms: 'X/Twitter DMs',
  instagram: 'Instagram DMs',
  instagram_enrich: 'Instagram Enrichment',
  facebook: 'Facebook Messenger',
  substack: 'Substack',
};

const STALE_THRESHOLDS: Record<string, number> = {
  imessage: 14, // 2 weeks
  whatsapp: 14,
  apple_contacts: 30, // 1 month
  linkedin: 90, // 3 months
  call_history: 90,
  x: 90,
  twitter_dms: 90,
  instagram: 90,
  instagram_enrich: 90,
  facebook: 90,
  substack: 180,
};

function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

interface StayInTouchContact {
  id: number;
  display_name: string;
  profile_picture_url: string | null;
  stay_in_touch_days: number;
  last_contacted: string | null;
  linkedin_headline: string | null;
  organization: string | null;
  phones: string | null;
}

const CONTACT_TYPES = [
  { value: 'texted', label: 'Texted' },
  { value: 'called', label: 'Called' },
  { value: 'met', label: 'Met in person' },
  { value: 'email', label: 'Email' },
];

function ContactedPopover({ contactId, onDone }: { contactId: number; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const submit = async (type: string) => {
    await fetch(`/api/contacts/${contactId}/contacted`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, note }),
    });
    setNote('');
    setOpen(false);
    onDone();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
        Contacted
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            {CONTACT_TYPES.map((t) => (
              <Button
                key={t.value}
                size="sm"
                variant="secondary"
                className="text-xs"
                onClick={() => submit(t.value)}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <textarea
            className="w-full text-xs rounded border border-border bg-background p-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit('contacted');
              }
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StayInTouchCard({
  contact,
  onAction,
}: {
  contact: StayInTouchContact;
  onAction: () => void;
}) {
  const navigate = useNavigate();
  const days = daysAgo(contact.last_contacted);
  const overdue = days !== null && days > contact.stay_in_touch_days;
  const daysOverdue = days !== null ? days - contact.stay_in_touch_days : 0;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border ${
        overdue
          ? 'border-orange-500/30 bg-orange-500/5'
          : 'border-border bg-card'
      }`}
    >
      <button
        onClick={() => navigate(`/contacts/${contact.id}`)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
      >
        <Avatar className="h-8 w-8 shrink-0">
          {contact.profile_picture_url && (
            <AvatarImage src={contact.profile_picture_url} alt={contact.display_name} />
          )}
          <AvatarFallback className={`text-xs ${overdue ? 'bg-orange-500/20 text-orange-400' : 'bg-muted'}`}>
            {contact.display_name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {contact.display_name}
          </div>
          <div className="text-xs text-muted-foreground">
            {days !== null ? `${days}d ago` : 'never'} · every{' '}
            {contact.stay_in_touch_days}d
            {overdue && ` · ${daysOverdue}d overdue`}
          </div>
        </div>
      </button>
      <div className="flex gap-1 shrink-0">
        <ContactedPopover contactId={contact.id} onDone={onAction} />
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await fetch(`/api/contacts/${contact.id}/snooze`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ days: 7 }),
            });
            onAction();
          }}
        >
          +1w
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await fetch(`/api/contacts/${contact.id}/snooze`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ days: 30 }),
            });
            onAction();
          }}
        >
          +1m
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={async () => {
            await fetch(`/api/contacts/${contact.id}/stay-in-touch`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ paused: true }),
            });
            onAction();
          }}
        >
          Pause
        </Button>
      </div>
    </div>
  );
}

export function HomePage() {
  const [status, setStatus] = useState<SyncStatus[]>([]);
  const [stayInTouch, setStayInTouch] = useState<StayInTouchContact[]>([]);

  const loadData = () => {
    fetch('/api/sync-status')
      .then((r) => r.json())
      .then((data) => setStatus(data.status));
    fetch('/api/stay-in-touch')
      .then((r) => r.json())
      .then((data) => setStayInTouch(data.contacts));
  };

  useEffect(() => {
    loadData();
  }, []);

  const overdueContacts = stayInTouch.filter((c) => {
    const days = daysAgo(c.last_contacted);
    return days === null || days > c.stay_in_touch_days;
  });
  const upcomingContacts = stayInTouch.filter((c) => {
    const days = daysAgo(c.last_contacted);
    return days !== null && days <= c.stay_in_touch_days;
  });

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Home</h2>

      {stayInTouch.length > 0 && (
        <div className="space-y-3">
          {overdueContacts.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-orange-400">
                Overdue ({overdueContacts.length})
              </h3>
              {overdueContacts.map((c) => (
                <StayInTouchCard key={c.id} contact={c} onAction={loadData} />
              ))}
            </>
          )}
          {upcomingContacts.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-muted-foreground mt-4">
                Coming up ({upcomingContacts.length})
              </h3>
              {upcomingContacts.map((c) => (
                <StayInTouchCard key={c.id} contact={c} onAction={loadData} />
              ))}
            </>
          )}
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          Sync Status
        </h3>
        <div className="grid gap-2">
          {status.map((s) => {
            const days = daysAgo(s.last_ran);
            const threshold = STALE_THRESHOLDS[s.source] ?? 7;
            const isStale = days === null || days > threshold;
            const isWarning =
              days !== null && days > threshold * 0.7 && days <= threshold;

            return (
              <div
                key={s.source}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  isStale
                    ? 'border-orange-500/50 bg-orange-500/10'
                    : isWarning
                      ? 'border-yellow-500/30 bg-yellow-500/5'
                      : 'border-border bg-card'
                }`}
              >
                <div>
                  <div className="text-sm font-medium">
                    {SOURCE_LABELS[s.source] ?? s.source}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.last_ran
                      ? `Last synced ${days}d ago · ${s.last_count} items`
                      : 'Never synced'}
                  </div>
                </div>
                {isStale && (
                  <span className="text-xs text-orange-400 font-medium">
                    Needs sync
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Run <code className="bg-muted px-1 rounded">deno task sync</code> to
        sync iMessage, WhatsApp, and Apple Contacts.
      </div>
    </div>
  );
}

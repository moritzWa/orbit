import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command';
import { ContactList } from '@/components/contact-list';
import { Star, ChevronsUpDown } from 'lucide-react';
import type { Contact } from '@/types';

const PLATFORM_OPTIONS = [
  { value: "all", label: "All platforms" },
  { value: "x", label: "X/Twitter" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "whatsapp", label: "WhatsApp" },
];

export function ContactsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [locations, setLocations] = useState<Array<{city: string; count: number}>>([]);
  const [companies, setCompanies] = useState<Array<{company: string; count: number}>>([]);
  const [companyOpen, setCompanyOpen] = useState(false);

  // Persist filters in URL params
  const search = searchParams.get('q') ?? '';
  const sort = (searchParams.get('sort') ?? 'recent') as 'recent' | 'messages' | 'updated';
  const view = (searchParams.get('view') ?? 'grid') as 'grid' | 'list';
  const favoritesOnly = searchParams.get('favorites') === '1';
  const platform = searchParams.get('platform') ?? '';
  const location = searchParams.get('location') ?? '';
  const company = searchParams.get('company') ?? '';
  const gender = searchParams.get('gender') ?? '';

  const setFilter = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Save scroll on every scroll event, restore on mount
  useEffect(() => {
    const container = scrollContainerRef.current?.closest('.overflow-y-auto');
    if (!container) return;

    // Restore
    const saved = sessionStorage.getItem('contacts-scroll');
    if (saved) {
      // Wait for contacts to render before restoring
      const timer = setTimeout(() => { container.scrollTop = parseInt(saved); }, 100);
      return () => clearTimeout(timer);
    }
  }, [contacts.length]); // Re-run when contacts load

  useEffect(() => {
    const container = scrollContainerRef.current?.closest('.overflow-y-auto');
    if (!container) return;
    const onScroll = () => sessionStorage.setItem('contacts-scroll', String(container.scrollTop));
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  // Calculate columns from grid width
  const getColumns = () => {
    if (!gridRef.current) return 4;
    const gridStyle = window.getComputedStyle(gridRef.current);
    const cols = gridStyle.getPropertyValue("grid-template-columns").split(" ").length;
    return cols;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const cols = getColumns();
    const max = contacts.length - 1;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (focusedIndex === -1) {
        setFocusedIndex(0);
      } else {
        setFocusedIndex(Math.min(focusedIndex + cols, max));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (focusedIndex <= 0) {
        setFocusedIndex(-1);
        searchRef.current?.focus();
      } else {
        setFocusedIndex(Math.max(focusedIndex - cols, 0));
      }
    } else if (e.key === "ArrowRight" && focusedIndex >= 0) {
      e.preventDefault();
      setFocusedIndex(Math.min(focusedIndex + 1, max));
    } else if (e.key === "ArrowLeft" && focusedIndex >= 0) {
      e.preventDefault();
      setFocusedIndex(Math.max(focusedIndex - 1, 0));
    } else if (e.key === "Enter" && focusedIndex >= 0) {
      e.preventDefault();
      navigate(`/contacts/${contacts[focusedIndex].id}`);
    } else if (e.key === "Escape") {
      setFocusedIndex(-1);
      searchRef.current?.focus();
    }
  };

  // Scroll focused card into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const el = gridRef.current?.children[focusedIndex] as HTMLElement;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  // Reset focus when search changes
  useEffect(() => { setFocusedIndex(-1); }, [contacts]);

  const fetchContacts = useCallback(
    (q: string, s: string, o: number, append = false) => {
      setLoading(true);
      fetch(
        `/api/contacts?q=${encodeURIComponent(q)}&sort=${s}&limit=500&offset=${o}${favoritesOnly ? '&favorites=1' : ''}${platform ? `&platform=${platform}` : ''}${location ? `&location=${encodeURIComponent(location)}` : ''}${company ? `&company=${encodeURIComponent(company)}` : ''}${gender ? `&gender=${gender}` : ''}`
      )
        .then((r) => r.json())
        .then((data) => {
          setContacts((prev) =>
            append ? [...prev, ...data.contacts] : data.contacts
          );
          setTotal(data.total);
          setLoading(false);
        });
    },
    [favoritesOnly, platform, location, company, gender]
  );

  useEffect(() => {
    fetch("/api/locations").then((r) => r.json()).then((d) => setLocations(d.cities));
    fetch("/api/companies").then((r) => r.json()).then((d) => setCompanies(d.companies));
  }, []);

  useEffect(() => {
    fetchContacts('', sort, 0);
    setOffset(0);
  }, [sort, favoritesOnly, platform, location, company, gender, fetchContacts]);

  const handleSearch = (value: string) => {
    setFilter('q', value);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setOffset(0);
      fetchContacts(value, sort, 0);
    }, 300);
  };

  const loadMore = () => {
    const newOffset = offset + 500;
    setOffset(newOffset);
    fetchContacts(search, sort, newOffset, true);
  };

  return (
    <div ref={scrollContainerRef} onKeyDown={handleKeyDown}>
      <div className="sticky top-0 z-10 bg-transparent pb-4 flex gap-2 items-center">
        <Input
          ref={searchRef}
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="flex-1 min-w-[150px] bg-primary-foreground"
        />
        <Select value={sort} onValueChange={(v) => setFilter('sort', v)}>
          <SelectTrigger className="h-8 w-[120px] text-sm shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Recent</SelectItem>
            <SelectItem value="messages">Most msgs</SelectItem>
            <SelectItem value="updated">Updated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={searchParams.get('favorites') ?? "all"} onValueChange={(v) => setFilter('favorites', v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-[140px] text-sm shrink-0">
            <SelectValue placeholder="All contacts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All contacts</SelectItem>
            <SelectItem value="1">★ Favorites</SelectItem>
            <SelectItem value="0">Not favorites</SelectItem>
          </SelectContent>
        </Select>
        <Select value={platform || "all"} onValueChange={(v) => setFilter('platform', v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-[140px] text-sm">
            <SelectValue placeholder="All platforms" />
          </SelectTrigger>
          <SelectContent>
            {PLATFORM_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={location || "all"} onValueChange={(v) => setFilter('location', v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-[140px] text-sm">
            <SelectValue placeholder="All cities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cities</SelectItem>
            {locations.map((l) => (
              <SelectItem key={l.city} value={l.city}>{l.city} ({l.count})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
          <PopoverTrigger className="inline-flex items-center justify-between h-8 w-[160px] text-sm rounded-md border border-border bg-background px-3 hover:bg-muted/50">
            <span className="truncate">{company || "All companies"}</span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search company..." />
              <CommandList>
                <CommandEmpty>No company found.</CommandEmpty>
                <CommandItem onSelect={() => { setFilter('company', ''); setCompanyOpen(false); }}>
                  All companies
                </CommandItem>
                {companies.map((c) => (
                  <CommandItem key={c.company} onSelect={() => { setFilter('company', c.company); setCompanyOpen(false); }}>
                    {c.company} ({c.count})
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Select value={gender || "all"} onValueChange={(v) => setFilter('gender', v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-[100px] text-sm">
            <SelectValue placeholder="Gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="male">Male</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          <Button
            variant={view === 'grid' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('view', 'grid')}
          >
            Grid
          </Button>
          <Button
            variant={view === 'list' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('view', 'list')}
          >
            List
          </Button>
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {total} contacts
        </span>
      </div>

      <div className="" />
      <ContactList
        contacts={contacts}
        view={view}
        gridRef={gridRef}
        focusedIndex={focusedIndex}
        onSelect={(c) => navigate(`/contacts/${c.id}`)}
        onArchive={async (id) => {
          await fetch(`/api/contacts/${id}/archive`, { method: 'PUT' });
          setContacts((prev) => prev.filter((c) => c.id !== id));
          setTotal((t) => t - 1);
        }}
        onToggleStar={async (id, current) => {
          const days = current ? null : 90;
          await fetch(`/api/contacts/${id}/stay-in-touch`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days }),
          });
          setContacts((prev) =>
            prev.map((c) =>
              c.id === id ? { ...c, stay_in_touch_days: days } : c
            )
          );
        }}
      />

      {contacts.length < total && (
        <Button
          variant="outline"
          className="w-full"
          onClick={loadMore}
          disabled={loading}
        >
          {loading ? 'Loading...' : `Load more (${contacts.length}/${total})`}
        </Button>
      )}
    </div>
  );
}

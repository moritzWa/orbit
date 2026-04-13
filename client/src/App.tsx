import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { Sidebar } from '@/components/sidebar';
import { HomePage } from '@/components/home-page';
import { ContactsPage } from '@/components/contacts-page';
import { ContactDetail } from '@/components/contact-detail';
import { PhotoPicker } from '@/components/photo-picker';
import { Duplicates } from '@/components/duplicates';
import { LinkedInTest } from '@/components/linkedin-test';
import type { Contact } from '@/types';

function ContactPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [contact, setContact] = useState<Contact | null>(null);

  useEffect(() => {
    fetch(`/api/contacts/${id}`)
      .then((r) => r.json())
      .then(setContact);
  }, [id]);

  if (!contact) return <p className="text-muted-foreground">Loading...</p>;

  return <ContactDetail contact={contact} onBack={() => navigate(-1)} />;
}

export default function App() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        navigate("/contacts");
        // Focus search input after navigation
        setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>('input[placeholder*="Search"]');
          input?.focus();
          input?.select();
        }, 100);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  return (
    <div className="flex h-screen">
      <Toaster />
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="h-full">
          <Routes>
            <Route
              path="/"
              element={
                <div className="max-w-2xl mx-auto">
                  <HomePage />
                </div>
              }
            />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route
              path="/contacts/:id"
              element={
                <div className="max-w-2xl mx-auto h-full">
                  <ContactPage />
                </div>
              }
            />
            <Route
              path="/photos"
              element={
                <div className="max-w-2xl mx-auto">
                  <PhotoPicker />
                </div>
              }
            />
            <Route
              path="/duplicates"
              element={
                <div className="max-w-2xl mx-auto">
                  <Duplicates />
                </div>
              }
            />
            <Route
              path="/linkedin-test"
              element={
                <div className="max-w-2xl mx-auto">
                  <LinkedInTest />
                </div>
              }
            />
          </Routes>
        </div>
      </div>
    </div>
  );
}

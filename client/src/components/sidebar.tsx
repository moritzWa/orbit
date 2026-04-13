import { NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ThemeToggle, useTheme } from '@/components/theme-toggle';

export function Sidebar() {
  useTheme(); // Initialize theme on mount
  return (
    <div className="w-48 border-r border-border bg-card flex flex-col p-3 gap-1">
      <h1 className="text-lg font-bold px-2 py-3">Contacts</h1>
      <NavLink to="/" end className="w-full">
        {({ isActive }) => (
          <Button
            variant={isActive ? 'secondary' : 'ghost'}
            className="w-full justify-start"
          >
            Home
          </Button>
        )}
      </NavLink>
      <NavLink to="/contacts" className="w-full">
        {({ isActive }) => (
          <Button
            variant={isActive ? 'secondary' : 'ghost'}
            className="w-full justify-start"
          >
            Contacts
          </Button>
        )}
      </NavLink>
      <NavLink to="/photos" className="w-full">
        {({ isActive }) => (
          <Button
            variant={isActive ? 'secondary' : 'ghost'}
            className="w-full justify-start"
          >
            Photos
          </Button>
        )}
      </NavLink>
      <NavLink to="/duplicates" className="w-full">
        {({ isActive }) => (
          <Button
            variant={isActive ? 'secondary' : 'ghost'}
            className="w-full justify-start"
          >
            Duplicates
          </Button>
        )}
      </NavLink>
      <NavLink to="/linkedin-test" className="w-full">
        {({ isActive }) => (
          <Button
            variant={isActive ? 'secondary' : 'ghost'}
            className="w-full justify-start"
          >
            LinkedIn Test
          </Button>
        )}
      </NavLink>
      <div className="mt-auto pt-3">
        <ThemeToggle />
      </div>
    </div>
  );
}

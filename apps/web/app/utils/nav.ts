// Primary navigation (sidebar + bottom nav).
// NOTE: the mockup had a dedicated "Environments" item, but that view is just a
// pre-filtered vault (ENV_FILE + SECRET by environmentTag) with the same cards — not a
// priority. Dropped in favour of the in-list type/environment filters. Re-add here if a
// dedicated view is ever justified.
export interface NavItem {
  id: string;
  label: string;
  subtitle: string;
  icon: string; // lucide icon name (self-hosted via @iconify-json/lucide)
  to: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'vault', label: 'Vault', subtitle: 'All secrets', icon: 'i-lucide-lock', to: '/vault' },
  { id: 'generator', label: 'Generator', subtitle: 'Passwords & passphrases', icon: 'i-lucide-zap', to: '/generator' },
  { id: 'settings', label: 'Settings', subtitle: 'Account & security', icon: 'i-lucide-settings', to: '/settings' },
];

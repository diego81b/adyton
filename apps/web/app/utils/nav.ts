// Primary navigation — 4 items, authoritative per mockup (sidebar + bottom nav).
export interface NavItem {
  id: string;
  label: string;
  subtitle: string;
  icon: string; // lucide icon name (self-hosted via @iconify-json/lucide)
  to: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'vault', label: 'Vault', subtitle: 'All secrets', icon: 'i-lucide-lock', to: '/vault' },
  { id: 'environments', label: 'Environments', subtitle: 'ENV files & secrets', icon: 'i-lucide-layers', to: '/environments' },
  { id: 'generator', label: 'Generator', subtitle: 'Passwords & passphrases', icon: 'i-lucide-zap', to: '/generator' },
  { id: 'settings', label: 'Settings', subtitle: 'Account & security', icon: 'i-lucide-settings', to: '/settings' },
];

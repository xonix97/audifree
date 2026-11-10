import { GlassPanel } from './GlassPanel'
import {
  GridIcon,
  HomeIcon,
  LibraryIcon,
  PlaylistsIcon,
  SearchIcon,
  SettingsIcon,
} from './Icons'

export type NavSection = 'home' | 'browse' | 'search' | 'library' | 'playlists'

interface NavItem {
  id: NavSection
  label: string
  icon: typeof HomeIcon
}

const PRIMARY: NavItem[] = [
  { id: 'home', label: 'Listen Now', icon: HomeIcon },
  { id: 'browse', label: 'Browse', icon: GridIcon },
  { id: 'search', label: 'Search', icon: SearchIcon },
]

const LIBRARY: NavItem[] = [
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'playlists', label: 'Playlists', icon: PlaylistsIcon },
]

interface SidebarProps {
  active: NavSection
  onNavigate: (section: NavSection) => void
  onOpenSettings: () => void
}

export function Sidebar({ active, onNavigate, onOpenSettings }: SidebarProps) {
  const renderItem = (item: NavItem) => {
    const Icon = item.icon
    return (
      <button
        key={item.id}
        type="button"
        className="sidebar__item"
        data-active={active === item.id}
        onClick={() => onNavigate(item.id)}
        aria-current={active === item.id ? 'page' : undefined}
      >
        <Icon width={17} height={17} />
        <span>{item.label}</span>
      </button>
    )
  }

  return (
    <GlassPanel className="sidebar" tone="default" aria-label="Primary navigation">
      <div className="sidebar__brand">
        <span className="brand__mark" aria-hidden="true">♪</span>
        <span className="brand__name">Audifree</span>
      </div>

      <nav className="sidebar__nav">
        {PRIMARY.map(renderItem)}
        <p className="sidebar__label">Library</p>
        {LIBRARY.map(renderItem)}
      </nav>

      <div className="sidebar__footer">
        <button type="button" className="sidebar__item" onClick={onOpenSettings}>
          <SettingsIcon width={17} height={17} />
          <span>Settings</span>
        </button>
      </div>
    </GlassPanel>
  )
}

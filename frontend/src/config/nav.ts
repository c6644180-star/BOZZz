import { Activity, Bell, Box, BrainCircuit, ChartNoAxesCombined, Cuboid, Eye, Folder, Hand, HeartPulse, Home, Layers, MessageSquare, Mic, MonitorCog, MonitorSmartphone, Phone, Route, ScanLine, Settings, Smartphone, Telescope } from 'lucide-react'
import type { NavItem } from '../types/bozz'

export const navItems: NavItem[] = [
  { label: 'Command Center', path: '/', icon: Home, section: 'Operate' },
  { label: 'BOZZ Chat', path: '/chat', icon: MessageSquare, section: 'Operate' },
  { label: 'Voice Studio', path: '/voice-studio', icon: Mic, section: 'Operate', available: false },
  { label: 'Spatial Desktop', path: '/spatial', icon: MonitorCog, section: 'Operate' },
  { label: 'Projects', path: '/projects', icon: Folder, section: 'Intelligence' },
  { label: 'Research Lab', path: '/research', icon: Telescope, section: 'Intelligence' },
  { label: 'Vision', path: '/vision', icon: Eye, section: 'Intelligence' },
  { label: 'Gesture Lab', path: '/gesture', icon: Hand, section: 'Intelligence' },
  { label: 'Spatial Intelligence', path: '/spatial-intelligence', icon: ScanLine, section: 'Intelligence', available: false },
  { label: 'L3DME 3D Viewer', path: '/3d', icon: Box, section: 'Intelligence' },
  { label: '3D Engineering Studio', path: '/engineering-studio', icon: Cuboid, section: 'Intelligence', available: false },
  { label: 'BCI Messages', path: '/messages', icon: BrainCircuit, section: 'Intelligence' },
  { label: 'BCCI Calls', path: '/calls', icon: Phone, section: 'Intelligence' },
  { label: 'DEI Devices Hub', path: '/devices-hub', icon: MonitorSmartphone, section: 'Intelligence' },
  { label: 'Health', path: '/health', icon: HeartPulse, section: 'Intelligence', available: false },
  { label: 'Devices', path: '/devices', icon: Smartphone, section: 'Intelligence' },
  { label: 'Memory', path: '/memory', icon: BrainCircuit, section: 'Intelligence' },
  { label: 'Market Analyzer', path: '/market-analyzer', icon: ChartNoAxesCombined, section: 'Intelligence', available: false },
  { label: 'System', path: '/system', icon: Activity, section: 'System' },
  { label: 'Intent Map', path: '/intent-map', icon: Route, section: 'System' },
  { label: 'Module Registry', path: '/modules', icon: Layers, section: 'System' },
  { label: 'Notifications', path: '/notifications', icon: Bell, section: 'System' },
  { label: 'Settings', path: '/settings', icon: Settings, section: 'System' },
]

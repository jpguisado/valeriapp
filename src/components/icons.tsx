import {
  Baby,
  Bell,
  BedDouble,
  Sunrise,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Download,
  Heart,
  House,
  KeyRound,
  List,
  LogOut,
  Milk,
  Moon,
  NotebookPen,
  Pause,
  Pencil,
  Pill,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Ruler,
  Scan,
  Settings,
  Thermometer,
  Toilet,
  Trash2,
  Users,
  Weight,
  WifiOff,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { EventType } from '@shared/events'

/**
 * One Lucide icon per kind of event, always drawn in that event's accent
 * colour. No emoji: they render differently on every device and read as
 * decoration rather than as an interface.
 */
export const EVENT_ICONS: Record<EventType, LucideIcon> = {
  breast: Heart,
  bottle: Milk,
  pump: Baby,
  sleep: Moon,
  wakeup: Zap,
  diaper: Toilet,
  temperature: Thermometer,
  weight: Weight,
  height: Ruler,
  head: Scan,
  medication: Pill,
  note: NotebookPen,
}

export function EventIcon({
  type,
  size = 20,
  strokeWidth = 1.9,
}: {
  type: EventType
  size?: number
  strokeWidth?: number
}) {
  const Glyph = EVENT_ICONS[type]
  return <Glyph size={size} strokeWidth={strokeWidth} aria-hidden="true" />
}

export {
  BedDouble,
  Sunrise,
  Bell,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Download,
  House,
  KeyRound,
  List,
  LogOut,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Settings,
  Trash2,
  Users,
  WifiOff,
  X,
  Zap,
}
export type { LucideIcon }

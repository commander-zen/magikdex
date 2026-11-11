import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  ExternalLink, CircleHelp, CirclePlay, Hourglass, Info, Layers, ArrowLeftRight, Move, Pencil, Plus, RefreshCw, Search,
  Settings, Share, SlidersHorizontal, Pointer, Trash2, X,
} from "lucide-react";

// Lucide icons (2026-11-11, the shared Bracket Card look) behind the names the
// app already used. It was an icon FONT (Material Symbols from Google Fonts):
// a network request before any icon drew, and nothing offline in the native
// app. These are inline SVG, bundled.
//
// The old spans were sized by `fontSize` and coloured by `color` in their
// inline style; this reads the same two keys so call sites kept their styles.
const ICONS = {
  add: Plus,
  arrow_back: ArrowLeft,
  arrow_downward: ArrowDown,
  arrow_forward: ArrowRight,
  arrow_upward: ArrowUp,
  autorenew: RefreshCw,
  check: Check,
  chevron_left: ChevronLeft,
  chevron_right: ChevronRight,
  close: X,
  delete: Trash2,
  edit: Pencil,
  expand_less: ChevronUp,
  expand_more: ChevronDown,
  help: CircleHelp,
  hourglass_empty: Hourglass,
  info: Info,
  ios_share: Share,
  open_in_new: ExternalLink,
  open_with: Move,
  play_circle: CirclePlay,
  search: Search,
  settings: Settings,
  style: Layers,
  swap_horiz: ArrowLeftRight,
  swipe: Pointer,
  tune: SlidersHorizontal,
};

export default function Icon({ name, style = {}, size, strokeWidth = 1.75, ...rest }) {
  const Glyph = ICONS[name] ?? CircleHelp;
  // eslint-disable-next-line no-unused-vars
  const { fontSize, fontVariationSettings, ...css } = style;
  const px = size ?? fontSize ?? 24;
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      width={px}
      height={px}
      strokeWidth={strokeWidth}
      style={{ display: "block", flexShrink: 0, ...css }}
      {...rest}
    />
  );
}

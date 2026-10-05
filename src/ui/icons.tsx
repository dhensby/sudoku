import type { ReactNode } from 'react';

/*
 * The app's icons: inline SVG, drawn for this project from plain geometry on
 * a 24×24 grid with 2px round-capped strokes, so they share one visual weight
 * and take the colour of the text around them (`currentColor`). No icon
 * library — a couple of dozen paths are cheaper than a dependency.
 *
 * Every icon is decorative: `aria-hidden`, and `focusable="false"` so old
 * Edge/IE do not add each SVG as a tab stop. The button that holds one
 * carries the accessible name. Each renders 24px square by default; CSS on
 * the `icon` class (or the one passed in) can size it otherwise.
 */

export interface IconProps {
  /** Extra classes, after the base `icon` class. */
  className?: string;
}

function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className === undefined ? 'icon' : `icon ${className}`}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Two bars: pause the game. */
export function PauseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5.5v13M15 5.5v13" />
    </Icon>
  );
}

/** A right-pointing triangle: resume or start. */
export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5.5v13l10.5-6.5z" />
    </Icon>
  );
}

/** An arrow curling back to the left. */
export function UndoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 13.5 4 8.5l5-5" />
      <path d="M4 8.5h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  );
}

/** An arrow curling on to the right: Undo, mirrored. */
export function RedoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m15 13.5 5-5-5-5" />
      <path d="M20 8.5H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Icon>
  );
}

/** A backspace key: a tag pointing left with a cross in it. */
export function EraseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5h11a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 20 19H9l-6.5-7z" />
      <path d="m12.5 9.5 5 5M17.5 9.5l-5 5" />
    </Icon>
  );
}

/** A light bulb: a hint. */
export function HintIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 17.5h5M10.5 21h3" />
      <path d="M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.9.68 1.4 1.5 1.4 2.4v.9h5v-.9c0-.9.5-1.72 1.4-2.4A6.5 6.5 0 0 0 12 2.5z" />
    </Icon>
  );
}

/** Three dots in a row: more actions — the in-game "…" menu of help. */
export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </Icon>
  );
}

/**
 * Three bars: the app's menu (History, Share, Settings, Solving techniques,
 * Help) on a phone. Deliberately unlike the "…" of the game's help menu at
 * the foot of the screen, so the two are never mistaken for each other.
 */
export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </Icon>
  );
}

/** A clock face with an arrow winding it back. */
export function HistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12a8 8 0 1 0 2.34-5.66" />
      <path d="M6.34 2.34v4h4" />
      <path d="M12 8v4l2.5 2.5" />
    </Icon>
  );
}

/** An arrow rising out of a tray: send this somewhere. */
export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 14.5V3" />
      <path d="M7.5 7.5 12 3l4.5 4.5" />
      <path d="M8.5 10.5H6.5a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-2" />
    </Icon>
  );
}

/** An eight-toothed gear. */
export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.38 4.98 10.5 2.52 13.5 2.52 13.62 4.98 15.82 5.89 17.64 4.23 19.77 6.36 18.11 8.18 19.02 10.38 21.48 10.5 21.48 13.5 19.02 13.62 18.11 15.82 19.77 17.64 17.64 19.77 15.82 18.11 13.62 19.02 13.5 21.48 10.5 21.48 10.38 19.02 8.18 18.11 6.36 19.77 4.23 17.64 5.89 15.82 4.98 13.62 2.52 13.5 2.52 10.5 4.98 10.38 5.89 8.18 4.23 6.36 6.36 4.23 8.18 5.89z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

/** A question mark in a circle: how to play. */
export function HelpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.24c-.66.33-1.1.97-1.1 1.7v.56" />
      <path d="M12 17.25h.01" />
    </Icon>
  );
}

/** An open book: the guide to the solving techniques. */
export function BookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 6.5C10.5 5.17 8.33 4.5 5.5 4.5H3v14h2.5c2.83 0 5 .67 6.5 2 1.5-1.33 3.67-2 6.5-2H21v-14h-2.5c-2.83 0-5 .67-6.5 2z" />
      <path d="M12 6.5v14" />
    </Icon>
  );
}

/** A plus: start a new game. */
export function NewGameIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

/** A cross: close. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

/** Two overlapping sheets: copy. */
export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="1.5" />
      <path d="M15.5 8.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5" />
    </Icon>
  );
}

/** An arrow down onto a line: save a file. */
export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v12" />
      <path d="m7 10.5 5 5 5-5" />
      <path d="M4.5 20.5h15" />
    </Icon>
  );
}

/** An arrow up from a line: load a file. */
export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15.5v-12" />
      <path d="m7 8.5 5-5 5 5" />
      <path d="M4.5 20.5h15" />
    </Icon>
  );
}

/** A tick. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Icon>
  );
}

/** An open eye: reveal a cell's answer. */
export function RevealIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </Icon>
  );
}

/** An arrow circling back on itself: start the puzzle again. */
export function ResetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 3.5v4h4" />
    </Icon>
  );
}

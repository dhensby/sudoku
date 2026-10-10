import { watchFriendLabel } from './watch';

/**
 * The words of a button that plays a friend's solve — "Watch Dan's solve", or
 * "Watch your friend's solve" for a link with no name — as the Ready card, the
 * head-to-head and History show them: the name isolated from the words around
 * it with <bdi>, as everywhere a link's name is shown, and the whole held in
 * one span with the `button--wraps` class on its button. A button lays its
 * children out in a row, so the span keeps the words one run of text: no gap
 * opens between the name and "'s solve", and a long name, or a narrow card,
 * wraps the words onto a second line rather than pushing the button past the
 * box it sits in.
 */
export function WatchFriendText({ name }: { name: string | null }) {
  return (
    <span className="button__label">
      {name === null ? (
        watchFriendLabel(null)
      ) : (
        <>
          Watch <bdi>{name}</bdi>&apos;s solve
        </>
      )}
    </span>
  );
}

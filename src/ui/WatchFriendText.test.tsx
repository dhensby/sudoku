import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WatchFriendText } from './WatchFriendText';

describe('WatchFriendText', () => {
  it('names the friend, isolated from the words around it, in one run of text', () => {
    const { container } = render(<WatchFriendText name="سارة 2" />);
    const label = container.querySelector('.button__label')!;
    expect(container.children).toHaveLength(1);
    expect(label).toHaveTextContent("Watch سارة 2's solve");
    expect(label.querySelector('bdi')).toHaveTextContent('سارة 2');
  });

  it('says your friend’s for a link with no name', () => {
    const { container } = render(<WatchFriendText name={null} />);
    expect(container.querySelector('.button__label')).toHaveTextContent(
      "Watch your friend's solve",
    );
    expect(container.querySelector('bdi')).toBeNull();
  });
});

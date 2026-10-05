import {
  commandForKey,
  isModeModifierKey,
  isRepeatable,
  type KeyCommand,
  type KeyInput,
} from './keyboard';

/** A key press with no modifiers unless the test adds them. */
function press(init: Partial<KeyInput>): KeyInput {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  };
}

const digit = (d: number): KeyCommand => ({ type: 'digit', digit: d }) as KeyCommand;

describe('commandForKey: digits', () => {
  it.each<[string, Partial<KeyInput>, number]>([
    ['the top row', { key: '5', code: 'Digit5' }, 5],
    ['the numpad', { key: '7', code: 'Numpad7' }, 7],
    ['the numpad with Num Lock off', { key: 'ArrowUp', code: 'Numpad8' }, 8],
    // Shift and Alt flip the mode for one entry, and change what `key` says.
    ['Shift+5, which types %', { key: '%', code: 'Digit5', shiftKey: true }, 5],
    ['Option+5 on a Mac, which types ∞', { key: '∞', code: 'Digit5', altKey: true }, 5],
    ['Shift+Alt together', { key: 'ﬁ', code: 'Digit5', shiftKey: true, altKey: true }, 5],
    // Windows with Num Lock on reports Shift+Numpad8 as an arrow key.
    ['Shift+Numpad8 on Windows', { key: 'ArrowUp', code: 'Numpad8', shiftKey: true }, 8],
    ['an AZERTY top row, unshifted', { key: '(', code: 'Digit5' }, 5],
    ['an on-screen keyboard with no code', { key: '3', code: '' }, 3],
    ['an Unidentified code', { key: '9', code: 'Unidentified' }, 9],
    ['digit 1', { key: '1', code: 'Digit1' }, 1],
    ['digit 9', { key: '9', code: 'Numpad9' }, 9],
  ])('reads %s as a digit', (_, init, expected) => {
    expect(commandForKey(press(init))).toEqual(digit(expected));
  });

  it.each<[string, Partial<KeyInput>]>([
    ['zero on the top row', { key: '0', code: 'Digit0' }],
    ['zero on the numpad', { key: '0', code: 'Numpad0' }],
    ['zero with Num Lock off', { key: 'Insert', code: 'Numpad0' }],
    ['a zero from a keyboard with no code', { key: '0' }],
    // Cmd+1 switches tab and Ctrl+1 does on Windows; never steal them.
    ['Cmd+1', { key: '1', code: 'Digit1', metaKey: true }],
    ['Ctrl+1', { key: '1', code: 'Digit1', ctrlKey: true }],
    // Windows reports AltGr as Ctrl+Alt.
    ['AltGr+5', { key: '[', code: 'Digit5', ctrlKey: true, altKey: true }],
  ])('ignores %s', (_, init) => {
    expect(commandForKey(press(init))).toBeNull();
  });
});

describe('commandForKey: everything else', () => {
  it.each<[string, Partial<KeyInput>, KeyCommand]>([
    ['Backspace', { key: 'Backspace', code: 'Backspace' }, { type: 'erase' }],
    ['Delete', { key: 'Delete', code: 'Delete' }, { type: 'erase' }],
    ['Shift+Backspace', { key: 'Backspace', shiftKey: true }, { type: 'erase' }],
    ['ArrowUp', { key: 'ArrowUp' }, { type: 'move', direction: 'up' }],
    ['ArrowDown', { key: 'ArrowDown' }, { type: 'move', direction: 'down' }],
    ['ArrowLeft', { key: 'ArrowLeft' }, { type: 'move', direction: 'left' }],
    ['ArrowRight', { key: 'ArrowRight' }, { type: 'move', direction: 'right' }],
    // A player holding Shift or Alt to flip the mode still moves around; and
    // claiming Alt+Left keeps it from sending a Windows browser back a page.
    ['Alt+ArrowLeft', { key: 'ArrowLeft', altKey: true }, { type: 'move', direction: 'left' }],
    ['Shift+ArrowDown', { key: 'ArrowDown', shiftKey: true }, { type: 'move', direction: 'down' }],
    ['Space', { key: ' ', code: 'Space' }, { type: 'toggleMode' }],
    ['Space with no code', { key: ' ' }, { type: 'toggleMode' }],
    ['Ctrl+Z', { key: 'z', code: 'KeyZ', ctrlKey: true }, { type: 'undo' }],
    ['Cmd+Z', { key: 'z', code: 'KeyZ', metaKey: true }, { type: 'undo' }],
    ['Ctrl+Shift+Z', { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true }, { type: 'redo' }],
    ['Cmd+Shift+Z', { key: 'z', code: 'KeyZ', metaKey: true, shiftKey: true }, { type: 'redo' }],
    ['Ctrl+Y', { key: 'y', code: 'KeyY', ctrlKey: true }, { type: 'redo' }],
    // AZERTY: Z is printed where QWERTY has W, and Ctrl+Z means that key.
    ['Ctrl+Z on AZERTY', { key: 'z', code: 'KeyW', ctrlKey: true }, { type: 'undo' }],
    // A Cyrillic layout types я on the Z key; the shortcut still means undo.
    ['Ctrl+Z on a Cyrillic layout', { key: 'я', code: 'KeyZ', ctrlKey: true }, { type: 'undo' }],
    ['p', { key: 'p', code: 'KeyP' }, { type: 'pause' }],
    ['P', { key: 'P', code: 'KeyP', shiftKey: true }, { type: 'pause' }],
    ['P on a Cyrillic layout', { key: 'з', code: 'KeyP' }, { type: 'pause' }],
  ])('maps %s', (_, init, expected) => {
    expect(commandForKey(press(init))).toEqual(expected);
  });

  it.each<[string, Partial<KeyInput>]>([
    ['Shift+Space', { key: ' ', code: 'Space', shiftKey: true }],
    ['Alt+Space', { key: ' ', code: 'Space', altKey: true }],
    ['Ctrl+Space', { key: ' ', code: 'Space', ctrlKey: true }],
    // Cmd+Backspace and Cmd+arrows are text editing and history navigation.
    ['Cmd+Backspace', { key: 'Backspace', metaKey: true }],
    ['Cmd+ArrowLeft', { key: 'ArrowLeft', metaKey: true }],
    ['Ctrl+Alt+Z', { key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true }],
    // History in Mac browsers.
    ['Cmd+Y', { key: 'y', code: 'KeyY', metaKey: true }],
    ['Ctrl+Shift+Y', { key: 'Y', code: 'KeyY', ctrlKey: true, shiftKey: true }],
    ['Ctrl+P, which prints', { key: 'p', code: 'KeyP', ctrlKey: true }],
    ['Cmd+P', { key: 'p', code: 'KeyP', metaKey: true }],
    ['Option+P, which types π', { key: 'π', code: 'KeyP', altKey: true }],
    ['Ctrl+Enter', { key: 'Enter', code: 'Enter', ctrlKey: true }],
    [
      'Ctrl+Shift+2, which is not a letter',
      { key: '@', code: 'Digit2', ctrlKey: true, shiftKey: true },
    ],
    ['Tab', { key: 'Tab', code: 'Tab' }],
    ['Enter', { key: 'Enter', code: 'Enter' }],
    ['Escape', { key: 'Escape', code: 'Escape' }],
    ['a letter with no meaning', { key: 'q', code: 'KeyQ' }],
    ['a modifier on its own', { key: 'Shift', code: 'ShiftLeft', shiftKey: true }],
    ['punctuation', { key: '.', code: 'Period' }],
  ])('leaves %s to the browser', (_, init) => {
    expect(commandForKey(press(init))).toBeNull();
  });
});

describe('isRepeatable', () => {
  it.each<[KeyCommand, boolean]>([
    [{ type: 'move', direction: 'up' }, true],
    [{ type: 'erase' }, true],
    [{ type: 'undo' }, true],
    [{ type: 'redo' }, true],
    // Each of these would flicker on and off while the key is held.
    [digit(4), false],
    [{ type: 'toggleMode' }, false],
    [{ type: 'pause' }, false],
  ])('says %o repeats: %s', (command, expected) => {
    expect(isRepeatable(command)).toBe(expected);
  });
});

describe('isModeModifierKey', () => {
  it.each([
    ['Shift', true],
    ['Alt', true],
    ['Control', false],
    ['Meta', false],
    ['AltGraph', false],
    ['5', false],
  ])('says %s flips the mode: %s', (key, expected) => {
    expect(isModeModifierKey(key)).toBe(expected);
  });
});

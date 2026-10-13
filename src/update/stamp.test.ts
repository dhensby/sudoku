import { VERSION_META, versionIn, versionTag } from './stamp';

describe('the version stamp', () => {
  it('is a meta tag named for the version', () => {
    expect(VERSION_META).toBe('version');
    expect(versionTag('0123456789abcdef')).toBe('<meta name="version" content="0123456789abcdef">');
  });

  it('is read back from a page as the build writes it', () => {
    const page = `<html><head><title>Sudoku</title>  ${versionTag('fa4b990679fe5e85')}\n  </head></html>`;
    expect(versionIn(page)).toBe('fa4b990679fe5e85');
  });

  it('is nothing on a page without one', () => {
    expect(versionIn('<html><head><title>Sudoku</title></head></html>')).toBeNull();
    expect(versionIn('<meta name="description" content="Sudoku">')).toBeNull();
    expect(versionIn('')).toBeNull();
  });
});

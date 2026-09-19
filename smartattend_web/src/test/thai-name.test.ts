import { describe, it, expect } from 'vitest';
import { validateThaiFullName } from '@/lib/thai-name';

describe('validateThaiFullName', () => {
  it('accepts a title + Thai first name + Thai surname', () => {
    expect(validateThaiFullName('นายสมชาย ใจดี')).toBeNull();
    expect(validateThaiFullName('นางสาวสมหญิง ดีใจ')).toBeNull();
    expect(validateThaiFullName('นางสมหญิง ดีใจ')).toBeNull();
  });

  it('rejects a name with no title', () => {
    expect(validateThaiFullName('สมชาย ใจดี')).not.toBeNull();
  });

  it('rejects a title with no surname', () => {
    expect(validateThaiFullName('นายสมชาย')).not.toBeNull();
  });

  it('rejects English text even with a valid title', () => {
    expect(validateThaiFullName('นายSomchai Jaidee')).not.toBeNull();
  });

  it('rejects an empty name', () => {
    expect(validateThaiFullName('   ')).not.toBeNull();
  });

  it('does not let "นาง" swallow "นางสาว" incorrectly', () => {
    // "นางสาว" must still be recognized as its own title, not "นาง" + "สาว..."
    expect(validateThaiFullName('นางสาวปิยะดา รักเรียน')).toBeNull();
  });
});

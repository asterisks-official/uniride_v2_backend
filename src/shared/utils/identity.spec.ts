import { BlockedIdentityType } from '@prisma/client';
import { normaliseIdentity, identitiesToBlock } from './identity';

describe('normaliseIdentity', () => {
  describe('student ID', () => {
    const norm = (v: string) =>
      normaliseIdentity(BlockedIdentityType.STUDENT_ID, v);

    it('ignores the punctuation students type inconsistently', () => {
      // The whole point of the ban list: retyping the same ID a different way
      // must not get you a new account.
      expect(norm('221-15-6029')).toBe(norm('221156029'));
      expect(norm('221 15 6029')).toBe(norm('221-15-6029'));
      expect(norm(' 221-15-6029 ')).toBe(norm('221156029'));
    });

    it('ignores case', () => {
      expect(norm('CSE-221-15')).toBe(norm('cse22115'));
    });

    it('still separates different students', () => {
      expect(norm('221-15-6029')).not.toBe(norm('221-15-6030'));
    });
  });

  describe('phone', () => {
    const norm = (v: string) => normaliseIdentity(BlockedIdentityType.PHONE, v);

    it('treats every way of writing one number as the same number', () => {
      const expected = norm('+8801712345678');
      expect(norm('8801712345678')).toBe(expected);
      expect(norm('01712345678')).toBe(expected);
      expect(norm('+880 1712-345678')).toBe(expected);
    });

    it('still separates different numbers', () => {
      expect(norm('+8801712345678')).not.toBe(norm('+8801712345679'));
    });

    it('leaves a short number alone rather than mangling it', () => {
      expect(norm('12345')).toBe('12345');
    });
  });

  describe('email', () => {
    const norm = (v: string) => normaliseIdentity(BlockedIdentityType.EMAIL, v);

    it('ignores case and surrounding space', () => {
      expect(norm('  Shakib@DIU.edu.bd ')).toBe('shakib@diu.edu.bd');
    });
  });
});

describe('identitiesToBlock', () => {
  it('lists every identifier the account actually has', () => {
    expect(
      identitiesToBlock({
        email: 'Shakib@diu.edu.bd',
        studentIdNumber: '221-15-6029',
        phone: '+8801712345678',
      }),
    ).toEqual([
      { type: BlockedIdentityType.EMAIL, value: 'shakib@diu.edu.bd' },
      { type: BlockedIdentityType.STUDENT_ID, value: '221156029' },
      { type: BlockedIdentityType.PHONE, value: '1712345678' },
    ]);
  });

  it('skips the ones it does not have', () => {
    // A blank phone would otherwise be written as an empty blocked value and
    // bar every future signup that omits a phone number.
    expect(
      identitiesToBlock({
        email: 'a@diu.edu.bd',
        studentIdNumber: null,
        phone: '   ',
      }),
    ).toEqual([{ type: BlockedIdentityType.EMAIL, value: 'a@diu.edu.bd' }]);
  });
});

import { visibleGenderPrefs } from './rides.service';

describe('visibleGenderPrefs', () => {
  it('shows a woman unrestricted and female-only rides', () => {
    expect(visibleGenderPrefs('FEMALE')).toEqual(['ANY', 'FEMALE_ONLY']);
  });

  it('shows a man unrestricted and male-only rides', () => {
    expect(visibleGenderPrefs('MALE')).toEqual(['ANY', 'MALE_ONLY']);
  });

  it('never shows a man a female-only ride', () => {
    // The leak this rule exists to close: the feed used to apply genderPref
    // only when the viewer asked for it as a filter, so a female-only ride
    // appeared to every man on the platform.
    expect(visibleGenderPrefs('MALE')).not.toContain('FEMALE_ONLY');
  });

  it('never shows a woman a male-only ride', () => {
    expect(visibleGenderPrefs('FEMALE')).not.toContain('MALE_ONLY');
  });

  it('shows a user with no gender recorded only unrestricted rides', () => {
    // Fails closed. Roughly a thousand accounts predate the gender field, and
    // a safety control must not treat "unknown" as "permitted".
    expect(visibleGenderPrefs(null)).toEqual(['ANY']);
  });

  it('does not treat OTHER as satisfying a gendered restriction', () => {
    // Inherited from the join check so the two agree. A product call, not a
    // technical one — see the roles spec's open questions.
    expect(visibleGenderPrefs('OTHER')).toEqual(['ANY']);
  });

  it('always permits unrestricted rides', () => {
    for (const gender of ['MALE', 'FEMALE', 'OTHER', null] as const) {
      expect(visibleGenderPrefs(gender)).toContain('ANY');
    }
  });
});

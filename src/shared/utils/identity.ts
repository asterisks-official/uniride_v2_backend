import { BlockedIdentityType } from '@prisma/client';

/// A rider gets this many rejections. The third one bans them.
export const MAX_RIDER_REJECTIONS = 3;

/// Normalises an identifier before it is written to, or checked against, the
/// blocklist.
///
/// Without this a ban is trivially sidestepped: `221-15-6029` and `221156029`
/// are the same student, and `+8801712345678` and `01712345678` are the same
/// phone. Comparison has to happen on one canonical form or the list only
/// catches people who do not think to retype.
export function normaliseIdentity(
  type: BlockedIdentityType,
  value: string,
): string {
  const trimmed = value.trim().toLowerCase();
  switch (type) {
    case BlockedIdentityType.EMAIL:
      return trimmed;
    case BlockedIdentityType.STUDENT_ID:
      return trimmed.replace(/[^a-z0-9]/g, '');
    case BlockedIdentityType.PHONE: {
      const digits = trimmed.replace(/\D/g, '');
      // Bangladeshi numbers arrive as +8801…, 8801… or 01… — compare on the
      // last 10 digits, which is the part that identifies the subscriber.
      return digits.length > 10 ? digits.slice(-10) : digits;
    }
  }
}

/// The identifiers a banned account is blocked on, skipping any it never had.
export function identitiesToBlock(user: {
  email: string;
  studentIdNumber: string | null;
  phone: string | null;
}): { type: BlockedIdentityType; value: string }[] {
  const candidates: [BlockedIdentityType, string | null][] = [
    [BlockedIdentityType.EMAIL, user.email],
    [BlockedIdentityType.STUDENT_ID, user.studentIdNumber],
    [BlockedIdentityType.PHONE, user.phone],
  ];

  return candidates
    .filter(([, value]) => !!value && value.trim() !== '')
    .map(([type, value]) => ({
      type,
      value: normaliseIdentity(type, value as string),
    }));
}

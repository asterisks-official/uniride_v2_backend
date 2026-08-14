import { ActiveMode, UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  /// Capability: whether this user may drive. Admin-granted.
  role: UserRole;
  /// View: which side of the market the user is currently browsing.
  ///
  /// Carried in the token because JwtStrategy.validate() does not hit the
  /// database — the feed reads this payload directly, so a mode change only
  /// takes effect once a new token is issued. Switching mode therefore
  /// reissues both tokens.
  ///
  /// Optional so tokens minted before this field existed still validate; the
  /// feed falls back to PASSENGER, which is the safe default.
  activeMode?: ActiveMode;
  iat?: number;
  exp?: number;
}

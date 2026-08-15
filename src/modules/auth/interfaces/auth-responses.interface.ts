export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  isEmailVerified: boolean;

  /// Whether this account was created as a rider application. The client keeps
  /// such accounts on the application screen until `role` becomes RIDER.
  signedUpAsRider: boolean;
}

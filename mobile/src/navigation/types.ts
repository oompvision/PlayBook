export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Book: { date?: string; bayId?: string } | undefined;
  Bookings: undefined;
  Membership: undefined;
  Account: undefined;
};

export type RootStackParamList = {
  Main: undefined;
  Auth: undefined;
  FacilityPicker: undefined;
};

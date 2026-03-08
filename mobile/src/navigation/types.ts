export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
};

export interface ModifyBookingParams {
  id: string;
  confirmationCode: string;
  bayId: string;
  bayName: string;
  date: string;
  startTime: string;
  endTime: string;
  totalPriceCents: number;
  notes?: string;
  slotIds: string[];
}

export type MainTabParamList = {
  Home: undefined;
  Book: { date?: string; bayId?: string; modifyBooking?: ModifyBookingParams } | undefined;
  Bookings: undefined;
  Membership: undefined;
  Account: undefined;
};

export type RootStackParamList = {
  Main: undefined;
  Auth: undefined;
  FacilityPicker: undefined;
};

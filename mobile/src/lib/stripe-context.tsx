import React, { createContext, useContext, useState, useCallback } from 'react';

interface StripeAccountContextValue {
  stripeAccountId: string | undefined;
  setStripeAccountId: (id: string | undefined) => void;
}

const StripeAccountContext = createContext<StripeAccountContextValue>({
  stripeAccountId: undefined,
  setStripeAccountId: () => {},
});

export function StripeAccountProvider({ children }: { children: React.ReactNode }) {
  const [stripeAccountId, setStripeAccountId] = useState<string | undefined>();
  return (
    <StripeAccountContext.Provider value={{ stripeAccountId, setStripeAccountId }}>
      {children}
    </StripeAccountContext.Provider>
  );
}

export function useStripeAccount() {
  return useContext(StripeAccountContext);
}

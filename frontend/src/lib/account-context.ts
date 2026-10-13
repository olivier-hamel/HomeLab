import { createContext, useContext } from "react";
import type { AccountName, HomeLabUser } from "./accounts";

export const AccountContext = createContext<{
  user: HomeLabUser; accounts: AccountName[]; busy: boolean; logout: () => void; changePassword: () => void;
} | null>(null);

export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) throw new Error("HomeLab requires an authenticated account.");
  return account;
}

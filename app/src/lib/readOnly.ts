// Read-only mode: the "view as" Account page (#/account?as=0x...) shows any address's account with no wallet. Inside
// it every write control is disabled, and useTx refuses to send even if one were clicked.
import { createContext, useContext } from "react";

export const ReadOnlyContext = createContext(false);

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

export const READ_ONLY_MESSAGE =
  "This is a read-only view of another account, so nothing can be sent from it. Connect your own wallet and open " +
  "Account to act.";

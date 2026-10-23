import { createMediaApi as createApi } from '../../src/lib/media/api.ts';

// Existing media fixtures isolate media services from the account service.
// accounts.test.mjs separately exercises the real session verifier and gates.
export const accountSession = {
  user: { username: 'oli', display_name: 'Oli', must_change_password: false },
  accounts: [{ username: 'oli', display_name: 'Oli' }, { username: 'max', display_name: 'Max' }],
};
export function createMediaApi(fetcher, converter) {
  return createApi(fetcher, converter, async () => accountSession);
}

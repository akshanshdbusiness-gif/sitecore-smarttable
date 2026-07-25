'use client';

import { useEffect, useState } from 'react';
import { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';
import type { GraphqlOperation } from '../sitecore/queries';

/**
 * The base client package ships only the `pages.context` / `application.context`
 * query keys. `xmc.authoring.graphql` — every write this app makes — is
 * contributed by the XMC module, registered here via `modules: [XMC]`; without
 * it the mutation key simply does not exist.
 */
let clientPromise: Promise<ClientSDK> | null = null;

function initClient(): Promise<ClientSDK> {
  if (!clientPromise) {
    clientPromise = ClientSDK.init({ target: window.parent, modules: [XMC] });
  }
  return clientPromise;
}

export function useMarketplaceClient() {
  const [client, setClient] = useState<ClientSDK | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    initClient()
      .then((c) => {
        if (!cancelled) setClient(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { client, error };
}

/**
 * Adapt the SDK into the plain `GqlRunner` the write engine expects, so the
 * engine stays transport-agnostic and unit-testable.
 *
 * Writes travel on the signed-in author's session, not an application secret —
 * Sitecore's own item permissions therefore apply, and there is no credential
 * for a consuming project to store or leak.
 */
export function createRunner(client: ClientSDK) {
  return async (op: GraphqlOperation): Promise<unknown> => {
    const response = (await client.mutate('xmc.authoring.graphql', {
      params: { body: { query: op.query, variables: op.variables } },
    })) as { data?: { data?: unknown; errors?: Array<{ message: string }> } };

    const errors = response?.data?.errors;
    if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
    return response?.data?.data;
  };
}

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
 * The Authoring API is multi-tenant: without a Sitecore context id it has no
 * environment to resolve against and answers 404 "No sitecore context" — not
 * a GraphQL error, so it surfaces as a transport failure. Resolved once and
 * cached; `.preview` is the draft/authoring context, which is what this app
 * writes to, with `.live` as a fallback rather than failing outright.
 */
let contextIdPromise: Promise<string> | null = null;

export function getSitecoreContextId(client: ClientSDK): Promise<string> {
  if (!contextIdPromise) {
    contextIdPromise = (async () => {
      const { data } = await client.query('application.context');
      const resource = data?.resourceAccess?.[0];
      const contextId = resource?.context?.preview || resource?.context?.live;
      if (!contextId) {
        throw new Error(
          'No Sitecore context id in application.context. Confirm an environment ' +
            'is linked to this app in Cloud Portal (App access > your installed app). ' +
            `resourceAccess: ${JSON.stringify(data?.resourceAccess ?? [])}`
        );
      }
      return contextId;
    })();
  }
  return contextIdPromise;
}

/**
 * Force the Pages canvas to re-render.
 *
 * This app writes through the Authoring API, bypassing Sitecore's own field
 * editing flow entirely, so the canvas has no reason to know the table changed
 * and would keep showing the pre-paste rows until the author reloaded by hand.
 */
export async function reloadPagesCanvas(client: ClientSDK): Promise<void> {
  await client.mutate('pages.reloadCanvas');
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
    const sitecoreContextId = await getSitecoreContextId(client);

    const response = (await client.mutate('xmc.authoring.graphql', {
      params: {
        body: { query: op.query, variables: op.variables },
        query: { sitecoreContextId },
      },
    })) as { data?: { data?: unknown; errors?: Array<{ message: string }> } };

    const errors = response?.data?.errors;
    if (errors?.length) {
      // path/extensions identify which field or argument was rejected; the
      // message alone often does not.
      console.error('Authoring API error', {
        query: op.query,
        variables: op.variables,
        errors,
      });
      throw new Error(errors.map((e) => e.message).join('; '));
    }
    return response?.data?.data;
  };
}

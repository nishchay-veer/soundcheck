import { pickServerEnv } from "./env";
import { getSecretManager } from "./gcp";

/** Secret Manager secret names, created by infra/08-secrets.sh. */
export const SECRET_NAMES = {
  oauthClientId: "oauth-client-id",
  oauthClientSecret: "oauth-client-secret",
  authSecret: "auth-secret",
} as const;

const cache = new Map<string, Promise<string>>();

/** The latest version of a secret, read once per process. Failures are not cached. */
export function readSecret(name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  const value = (async () => {
    const project = pickServerEnv(["GCP_PROJECT_ID"]).GCP_PROJECT_ID;
    const [version] = await getSecretManager().accessSecretVersion({
      name: `projects/${project}/secrets/${name}/versions/latest`,
    });
    const data = version.payload?.data;
    if (!data) throw new Error(`Secret ${name} has no value`);
    return typeof data === "string" ? data : Buffer.from(data).toString("utf8");
  })();
  cache.set(name, value);
  value.catch(() => cache.delete(name));
  return value;
}

/** Tests only. */
export function resetSecretCache(): void {
  cache.clear();
}

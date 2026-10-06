/** In-memory stand-in for Secret Manager's accessSecretVersion, for unit tests. */
import type { SecretManagerServiceClient } from "@google-cloud/secret-manager";

export class FakeSecretManager {
  readonly reads: string[] = [];

  constructor(private readonly secrets: Record<string, string>) {}

  async accessSecretVersion(request: { name?: string | null }) {
    const name = request.name ?? "";
    this.reads.push(name);
    const secret = /\/secrets\/([^/]+)\/versions\/latest$/.exec(name)?.[1];
    const value = secret === undefined ? undefined : this.secrets[secret];
    if (value === undefined) throw Object.assign(new Error(`5 NOT_FOUND: ${name}`), { code: 5 });
    return [{ payload: { data: Buffer.from(value) } }] as const;
  }

  asSecretManager(): SecretManagerServiceClient {
    return this as unknown as SecretManagerServiceClient;
  }
}

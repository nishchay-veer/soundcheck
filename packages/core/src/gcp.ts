import { BigQuery } from "@google-cloud/bigquery";
import { Firestore } from "@google-cloud/firestore";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Storage } from "@google-cloud/storage";
import { ExecutionsClient } from "@google-cloud/workflows";
import { getEnv } from "./env";

/**
 * Lazy singletons for the Google Cloud clients. Nothing is constructed (and no
 * env is read) until a getter is first called. Tests swap in fakes with
 * `setClientOverride`.
 */
export interface GcpClients {
  bigquery: BigQuery;
  firestore: Firestore;
  storage: Storage;
  kms: KeyManagementServiceClient;
  workflowExecutions: ExecutionsClient;
  secretManager: SecretManagerServiceClient;
}
export type GcpClientName = keyof GcpClients;

const factories: { [K in GcpClientName]: () => GcpClients[K] } = {
  bigquery: () => {
    const env = getEnv();
    return new BigQuery({ projectId: env.GCP_PROJECT_ID, location: env.BQ_LOCATION });
  },
  firestore: () => {
    const env = getEnv();
    return new Firestore({ projectId: env.GCP_PROJECT_ID, databaseId: env.FIRESTORE_DATABASE });
  },
  storage: () => new Storage({ projectId: getEnv().GCP_PROJECT_ID }),
  kms: () => new KeyManagementServiceClient({ projectId: getEnv().GCP_PROJECT_ID }),
  workflowExecutions: () => new ExecutionsClient({ projectId: getEnv().GCP_PROJECT_ID }),
  secretManager: () => new SecretManagerServiceClient({ projectId: getEnv().GCP_PROJECT_ID }),
};

const instances: Partial<GcpClients> = {};
const overrides: Partial<GcpClients> = {};

function client<K extends GcpClientName>(name: K): GcpClients[K] {
  const override = overrides[name];
  if (override) return override;
  const existing = instances[name];
  if (existing) return existing;
  const created = factories[name]();
  instances[name] = created;
  return created;
}

export const getBigQuery = (): BigQuery => client("bigquery");
export const getFirestore = (): Firestore => client("firestore");
export const getStorage = (): Storage => client("storage");
export const getKms = (): KeyManagementServiceClient => client("kms");
export const getWorkflowExecutions = (): ExecutionsClient => client("workflowExecutions");
export const getSecretManager = (): SecretManagerServiceClient => client("secretManager");

/** Tests only: replace a client with a fake, or pass `undefined` to remove the override. */
export function setClientOverride<K extends GcpClientName>(
  name: K,
  fake: GcpClients[K] | undefined,
): void {
  if (fake === undefined) delete overrides[name];
  else overrides[name] = fake;
}

/** Tests only: drop every override and every constructed client. */
export function resetClients(): void {
  for (const name of Object.keys(factories) as GcpClientName[]) {
    delete overrides[name];
    delete instances[name];
  }
}

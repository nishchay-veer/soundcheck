import { BigQuery } from "@google-cloud/bigquery";
import { Firestore } from "@google-cloud/firestore";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Storage } from "@google-cloud/storage";
import { ExecutionsClient } from "@google-cloud/workflows";
import { GoogleGenAI } from "@google/genai";
import { pickServerEnv } from "./env";

/**
 * Lazy singletons for the Google Cloud clients. Nothing is constructed (and no
 * env is read) until a getter is first called. Each factory validates only the
 * variables it uses, so pipeline jobs do not need the web app's auth secrets.
 * Tests swap in fakes with `setClientOverride`.
 */
export interface GcpClients {
  bigquery: BigQuery;
  firestore: Firestore;
  storage: Storage;
  kms: KeyManagementServiceClient;
  workflowExecutions: ExecutionsClient;
  secretManager: SecretManagerServiceClient;
  /** Gemini on Vertex AI, authenticated with Application Default Credentials. */
  genai: GoogleGenAI;
}
export type GcpClientName = keyof GcpClients;

const projectId = (): string => pickServerEnv(["GCP_PROJECT_ID"]).GCP_PROJECT_ID;

const factories: { [K in GcpClientName]: () => GcpClients[K] } = {
  bigquery: () => {
    const env = pickServerEnv(["GCP_PROJECT_ID", "BQ_LOCATION"]);
    return new BigQuery({ projectId: env.GCP_PROJECT_ID, location: env.BQ_LOCATION });
  },
  firestore: () => {
    const env = pickServerEnv(["GCP_PROJECT_ID", "FIRESTORE_DATABASE"]);
    return new Firestore({ projectId: env.GCP_PROJECT_ID, databaseId: env.FIRESTORE_DATABASE });
  },
  storage: () => new Storage({ projectId: projectId() }),
  kms: () => new KeyManagementServiceClient({ projectId: projectId() }),
  workflowExecutions: () => new ExecutionsClient({ projectId: projectId() }),
  secretManager: () => new SecretManagerServiceClient({ projectId: projectId() }),
  genai: () => {
    const env = pickServerEnv(["GCP_PROJECT_ID", "GEMINI_LOCATION"]);
    return new GoogleGenAI({
      vertexai: true,
      project: env.GCP_PROJECT_ID,
      location: env.GEMINI_LOCATION,
    });
  },
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
export const getGenAI = (): GoogleGenAI => client("genai");

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

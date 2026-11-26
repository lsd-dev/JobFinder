import type { Company, CompanyHealth, JobStage, JobStatus, Profile, Settings, StoredJob } from "../types";

export type Unsubscribe = () => void;
export interface Config {
  profile: Profile;
  settings: Settings;
}

/**
 * Everything the UI needs from storage. Two implementations: Firestore (real
 * data under your space key) and an in-memory demo (?demo in the URL).
 */
export interface DataSource {
  readonly demo: boolean;
  subscribeJobs(onData: (jobs: StoredJob[]) => void, onError: (e: Error) => void): Unsubscribe;
  subscribeCompanies(onData: (companies: Company[]) => void, onError: (e: Error) => void): Unsubscribe;
  subscribeHealth(onData: (health: Record<string, CompanyHealth>) => void, onError: (e: Error) => void): Unsubscribe;
  setStatus(jobId: string, status: JobStatus): Promise<void>;
  /** Reply received for an applied job; null clears it ("waiting for reply"). */
  setStage(jobId: string, stage: JobStage | null): Promise<void>;
  setNotes(jobId: string, notes: string): Promise<void>;
  saveCompany(company: Company): Promise<void>;
  deleteCompany(companyId: string): Promise<void>;
  loadConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<void>;
  /** Register this browser's push token. `isNew` is false when only refreshing lastSeenAt. */
  saveDevice(token: string, isNew: boolean): Promise<void>;
  deleteDevice(token: string): Promise<void>;
}

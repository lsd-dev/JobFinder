import { initializeApp } from "firebase/app";
import {
  collection, deleteDoc, deleteField, doc, getDoc, initializeFirestore, onSnapshot, persistentLocalCache,
  persistentMultipleTabManager, setDoc, updateDoc, type Firestore,
} from "firebase/firestore";
import { firebaseConfig } from "../firebaseConfig";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Company, type CompanyHealth, type JobStatus, type Profile, type Settings, type StoredJob } from "../types";
import type { Config, DataSource, Unsubscribe } from "./source";

/** Firestore stores "not set" notification markers as null; the UI treats null as absent. */
function dropNulls<T>(d: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (v !== null) out[k] = v;
  return out as T;
}

/** Firestore rejects undefined values. */
function clean<T extends object>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

// One Firestore instance per page: it can only be initialised once, also when
// the key is forgotten and a new one is entered.
let shared: Firestore | undefined;
function database(): Firestore {
  // The local cache means a reload only downloads documents that changed,
  // which keeps the dashboard well inside the free daily read quota.
  return (shared ??= initializeFirestore(initializeApp(firebaseConfig), { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }));
}

export class FirestoreSource implements DataSource {
  readonly demo = false;
  private readonly db: Firestore;
  private readonly root: string;

  constructor(spaceKey: string) {
    this.db = database();
    this.root = `spaces/${spaceKey}`;
  }

  subscribeJobs(onData: (jobs: StoredJob[]) => void, onError: (e: Error) => void): Unsubscribe {
    return onSnapshot(collection(this.db, this.root, "jobs"), (s) => onData(s.docs.map((d) => dropNulls<StoredJob>(d.data()))), onError);
  }

  subscribeCompanies(onData: (companies: Company[]) => void, onError: (e: Error) => void): Unsubscribe {
    return onSnapshot(collection(this.db, this.root, "companies"), (s) => onData(s.docs.map((d) => d.data() as Company)), onError);
  }

  subscribeHealth(onData: (health: Record<string, CompanyHealth>) => void, onError: (e: Error) => void): Unsubscribe {
    return onSnapshot(
      collection(this.db, this.root, "health"),
      (s) => onData(Object.fromEntries(s.docs.map((d) => [d.id, d.data() as CompanyHealth]))),
      onError,
    );
  }

  async setStatus(jobId: string, status: JobStatus): Promise<void> {
    // The security rules allow changing only status, appliedAt and notes.
    await updateDoc(doc(this.db, this.root, "jobs", jobId), {
      status,
      appliedAt: status === "applied" ? new Date().toISOString() : deleteField(),
    });
  }

  async setNotes(jobId: string, notes: string): Promise<void> {
    await updateDoc(doc(this.db, this.root, "jobs", jobId), { notes: notes.slice(0, 2000) });
  }

  async saveCompany(company: Company): Promise<void> {
    await setDoc(doc(this.db, this.root, "companies", company.id), clean(company));
  }

  async deleteCompany(companyId: string): Promise<void> {
    await deleteDoc(doc(this.db, this.root, "companies", companyId));
  }

  async loadConfig(): Promise<Config> {
    const [p, s] = await Promise.all([getDoc(doc(this.db, this.root, "config", "profile")), getDoc(doc(this.db, this.root, "config", "settings"))]);
    return {
      profile: { ...DEFAULT_PROFILE, ...(p.data() as Partial<Profile> | undefined) },
      settings: { ...DEFAULT_SETTINGS, ...(s.data() as Partial<Settings> | undefined) },
    };
  }

  async saveConfig(config: Config): Promise<void> {
    await Promise.all([
      setDoc(doc(this.db, this.root, "config", "profile"), clean(config.profile)),
      setDoc(doc(this.db, this.root, "config", "settings"), clean(config.settings)),
    ]);
  }

  async saveDevice(token: string, isNew: boolean): Promise<void> {
    // The security rules allow exactly these four fields.
    const now = new Date().toISOString();
    await setDoc(
      doc(this.db, this.root, "devices", token),
      { token, lastSeenAt: now, userAgent: navigator.userAgent.slice(0, 300), ...(isNew ? { createdAt: now } : {}) },
      { merge: true },
    );
  }

  async deleteDevice(token: string): Promise<void> {
    await deleteDoc(doc(this.db, this.root, "devices", token));
  }
}

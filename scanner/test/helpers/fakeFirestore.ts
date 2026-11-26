/**
 * Minimal in-memory stand-in for the parts of the Admin Firestore API that
 * FirestoreStore uses. It checks the store's logic (ids, null markers, query
 * filters, batching); it does NOT prove behaviour against real Firestore.
 */
type Data = Record<string, unknown>;
type Filter = [field: string, op: "==" | "<", value: unknown];

export class FakeFirestore {
  readonly docs = new Map<string, Data>();
  reads = 0;
  writes = 0;

  collection(path: string): FakeCollection {
    return new FakeCollection(this, path, []);
  }
  async getAll(...refs: FakeDoc[]): Promise<FakeSnap[]> {
    return Promise.all(refs.map((r) => r.get()));
  }
  batch() {
    const ops: (() => Promise<unknown>)[] = [];
    const b = {
      set: (ref: FakeDoc, data: Data, opts?: { merge?: boolean }) => (ops.push(() => ref.set(data, opts)), b),
      update: (ref: FakeDoc, data: Data) => (ops.push(() => ref.update(data)), b),
      delete: (ref: FakeDoc) => (ops.push(() => ref.delete()), b),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
    return b;
  }
}

export class FakeSnap {
  constructor(readonly ref: FakeDoc, private readonly value: Data | undefined) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this.value !== undefined;
  }
  data(): Data | undefined {
    return this.value === undefined ? undefined : structuredClone(this.value);
  }
}

export class FakeDoc {
  constructor(private readonly db: FakeFirestore, readonly path: string) {}
  get id() {
    return this.path.split("/").pop()!;
  }
  collection(name: string) {
    return new FakeCollection(this.db, `${this.path}/${name}`, []);
  }
  async get() {
    this.db.reads++;
    return new FakeSnap(this, this.db.docs.get(this.path));
  }
  async set(data: Data, opts?: { merge?: boolean }) {
    assertNoUndefined(data);
    this.db.writes++;
    this.db.docs.set(this.path, opts?.merge ? { ...this.db.docs.get(this.path), ...structuredClone(data) } : structuredClone(data));
  }
  async create(data: Data) {
    if (this.db.docs.has(this.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
    await this.set(data);
  }
  async update(data: Data) {
    const cur = this.db.docs.get(this.path);
    if (!cur) throw Object.assign(new Error("NOT_FOUND"), { code: 5 });
    this.db.writes++;
    this.db.docs.set(this.path, { ...cur, ...structuredClone(data) });
  }
  async delete() {
    this.db.writes++;
    this.db.docs.delete(this.path);
  }
}

export class FakeCollection {
  constructor(private readonly db: FakeFirestore, private readonly path: string, private readonly filters: Filter[]) {}
  doc(id: string) {
    if (!id || id.includes("/")) throw new Error(`bad document id "${id}"`);
    return new FakeDoc(this.db, `${this.path}/${id}`);
  }
  where(field: string, op: "==" | "<", value: unknown) {
    return new FakeCollection(this.db, this.path, [...this.filters, [field, op, value]]);
  }
  async get() {
    const docs: FakeSnap[] = [];
    for (const [p, d] of this.db.docs) {
      if (!p.startsWith(this.path + "/") || p.slice(this.path.length + 1).includes("/")) continue;
      // Like Firestore: a filter never matches a document that lacks the field.
      const ok = this.filters.every(([f, op, v]) => f in d && (op === "==" ? d[f] === v : (d[f] as string) < (v as string)));
      if (ok) docs.push(new FakeSnap(new FakeDoc(this.db, p), d));
    }
    this.db.reads += Math.max(docs.length, 1);
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

function assertNoUndefined(o: unknown): void {
  if (o === undefined) throw new Error("undefined value written to Firestore");
  if (o && typeof o === "object") for (const v of Object.values(o)) assertNoUndefined(v);
}

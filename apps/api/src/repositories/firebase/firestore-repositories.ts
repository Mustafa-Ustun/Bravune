import type { Firestore } from 'firebase-admin/firestore';
import type { EntityRepository, CareerProfileRepository, CvRepository, ApplicationRepository, CustomerRepository, SubscriptionRepository } from '../interfaces/repositories.js';
const now = () => new Date().toISOString();
class FirestoreEntityRepository implements EntityRepository<Record<string, unknown>> {
  constructor(protected db: Firestore, protected collection: string) {}
  protected ref(customerId: string) { return this.db.collection('customers').doc(customerId).collection(this.collection); }
  async list(customerId: string) { const s = await this.ref(customerId).get(); return s.docs.map(d => ({ id: d.id, ...d.data() })); }
  async get(customerId: string, id: string) { const d = await this.ref(customerId).doc(id).get(); return d.exists ? { id: d.id, ...d.data() } : null; }
  async create(customerId: string, value: Record<string, unknown>) { const d = this.ref(customerId).doc(); const created = { ...value, createdAt: now(), updatedAt: now() }; await d.create(created); return { id: d.id, ...created }; }
  async update(customerId: string, id: string, patch: Record<string, unknown>) { const d = this.ref(customerId).doc(id); if (!(await d.get()).exists) return null; await d.set({ ...patch, updatedAt: now() }, { merge: true }); return this.get(customerId, id); }
  async delete(customerId: string, id: string) { const d = this.ref(customerId).doc(id); if (!(await d.get()).exists) return false; await d.delete(); return true; }
}
export class FirebaseEntityRepository extends FirestoreEntityRepository {}
export class FirebaseCareerProfileRepository implements CareerProfileRepository {
  constructor(private db: Firestore) {}
  async get(customerId: string) { const d = await this.db.doc(`customers/${customerId}/profile/main`).get(); return d.exists ? d.data() ?? null : null; }
  async save(customerId: string, profile: Record<string, unknown>) { await this.db.doc(`customers/${customerId}/profile/main`).set({ ...profile, updatedAt: now() }, { merge: true }); }
}
export class FirebaseCvRepository extends FirestoreEntityRepository implements CvRepository {
  constructor(db: Firestore) { super(db, 'cvs'); }
  async createVersion(customerId: string, cvId: string, content: Record<string, unknown>) { const cv = await this.get(customerId, cvId); if (!cv) throw Object.assign(new Error('CV not found'), { status: 404 }); const versions = this.ref(customerId).doc(cvId).collection('versions'); const query = await versions.orderBy('version', 'desc').limit(1).get(); const data = { cvId, version: (query.docs[0]?.data().version as number ?? 0) + 1, content, createdAt: now() }; const doc = versions.doc(); await doc.create(data); await this.update(customerId, cvId, { currentVersionId: doc.id }); return { id: doc.id, ...data }; }
  async listVersions(customerId: string, cvId: string) { if (!(await this.get(customerId, cvId))) throw Object.assign(new Error('CV not found'), { status: 404 }); const s = await this.ref(customerId).doc(cvId).collection('versions').orderBy('version', 'desc').get(); return s.docs.map(d => ({ id: d.id, ...d.data() })); }
  async getVersion(customerId: string, cvId: string, versionId: string) { if (!(await this.get(customerId, cvId))) return null; const d = await this.ref(customerId).doc(cvId).collection('versions').doc(versionId).get(); return d.exists ? { id: d.id, ...d.data() } : null; }
}
export class FirebaseApplicationRepository extends FirestoreEntityRepository implements ApplicationRepository {
  constructor(db: Firestore) { super(db, 'applications'); }
  async addHistory(customerId: string, applicationId: string, entry: Record<string, unknown>) { const d = this.ref(customerId).doc(applicationId).collection('history').doc(); const value = { ...entry, createdAt: now() }; await d.create(value); return { id: d.id, ...value }; }
  async history(customerId: string, applicationId: string) { if (!(await this.get(customerId, applicationId))) throw Object.assign(new Error('Application not found'), { status: 404 }); const s = await this.ref(customerId).doc(applicationId).collection('history').orderBy('createdAt', 'asc').get(); return s.docs.map(d => ({ id: d.id, ...d.data() })); }
}
export class FirebaseCustomerRepository implements CustomerRepository {
  constructor(private db: Firestore) {}
  async get(customerId: string) { const d = await this.db.collection('customers').doc(customerId).get(); return d.exists ? { id: d.id, ...d.data() } : null; }
  async ensure(customerId: string, email: string) { const d = this.db.collection('customers').doc(customerId); if (!(await d.get()).exists) await d.create({ email, plan: 'free', createdAt: now(), updatedAt: now() }); }
}
export class FirebaseSubscriptionRepository implements SubscriptionRepository {
  constructor(private db: Firestore) {}
  async get(customerId: string) { const d = await this.db.collection('subscriptions').doc(customerId).get(); return d.exists ? d.data() ?? null : null; }
}

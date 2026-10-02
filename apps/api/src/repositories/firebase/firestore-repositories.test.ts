import { describe, expect, it } from 'vitest';
import { FirebaseApplicationRepository, FirebaseCareerProfileRepository, FirebaseCvRepository, FirebaseEntityRepository } from './firestore-repositories.js';

function pathRecordingFirestore() {
  const paths: string[] = [];
  const doc = (path: string) => ({
    get: async () => { paths.push(path); return { id: path.split('/').at(-1), exists: true, data: () => ({}) }; },
    collection: (name: string) => collection(`${path}/${name}`)
  });
  const collection = (path: string) => ({
    doc: (id: string) => doc(`${path}/${id}`),
    get: async () => { paths.push(path); return { docs: [] }; },
    orderBy: () => ({ get: async () => { paths.push(path); return { docs: [] }; } })
  });
  return { paths, db: { collection, doc } };
}

describe('Firestore ownership scoping', () => {
  it('builds every entity collection from the supplied authenticated customer ID', async () => {
    const paths: string[] = [];
    const fakeDb = {
      collection: (name: string) => ({ doc: (id: string) => ({ collection: (child: string) => {
        paths.push(`${name}/${id}/${child}`);
        return { get: async () => ({ docs: [] }) };
      } }) })
    };
    const repo = new FirebaseEntityRepository(fakeDb as never, 'jobs');
    await repo.list('customer-a');
    await repo.list('customer-b');
    expect(paths).toEqual(['customers/customer-a/jobs', 'customers/customer-b/jobs']);
  });

  it('scopes the canonical profile, CV, and application history to the requested customer', async () => {
    const { paths, db } = pathRecordingFirestore();
    await new FirebaseCareerProfileRepository(db as never).get('customer-a');
    await new FirebaseCvRepository(db as never).get('customer-a', 'cv-a');
    await new FirebaseApplicationRepository(db as never).history('customer-a', 'application-a');

    expect(paths).toEqual([
      'customers/customer-a/profile/main',
      'customers/customer-a/cvs/cv-a',
      'customers/customer-a/applications/application-a',
      'customers/customer-a/applications/application-a/history'
    ]);
  });
});

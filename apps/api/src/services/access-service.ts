import type { SubscriptionRepository } from '../repositories/interfaces/repositories.js';
export class AccessService {
  constructor(private subscriptions: SubscriptionRepository) {}
  async getAccess(customerId: string) {
    const subscription = await this.subscriptions.get(customerId);
    if (!subscription) return { plan: 'free' as const, status: 'active' as const };
    const end = subscription.currentPeriodEnd;
    const endTime = typeof end === 'string' ? Date.parse(end) : undefined;
    const expired = endTime !== undefined && (!Number.isFinite(endTime) || endTime < Date.now());
    if (expired) return { plan: 'free' as const, status: 'expired' as const };
    const active = subscription.status === 'active' || subscription.status === 'trialing';
    if (!active) return { plan: 'free' as const, status: 'inactive' as const };
    return { plan: subscription.plan === 'pro' ? 'pro' as const : 'free' as const, status: 'active' as const };
  }
  async assertCanCreate(customerId: string, type: 'cvs' | 'applications', count: number) {
    const access = await this.getAccess(customerId);
    const max = Number(process.env[type === 'cvs' ? 'FREE_MAX_CVS' : 'FREE_MAX_APPLICATIONS'] ?? (type === 'cvs' ? 3 : 50));
    if (access.plan === 'free' && count >= max) throw Object.assign(new Error(`Free plan ${type} limit reached.`), { status: 403, code: 'plan_limit' });
  }
}

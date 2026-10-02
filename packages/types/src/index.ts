export type Plan = 'free' | 'pro';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired' | 'inactive';
export type ApplicationStatus = 'saved' | 'applied' | 'screening' | 'interview' | 'offer' | 'rejected' | 'withdrawn';
export interface Customer { id: string; email: string; plan: Plan; createdAt: string; updatedAt: string }
export interface Subscription { customerId: string; status: SubscriptionStatus; plan: Plan; paymentCustomerId?: string; currentPeriodEnd?: string; createdAt: string; updatedAt: string }
export interface CareerProfile { personalInformation?: Record<string, unknown>; summary?: string; skills?: Array<Record<string, unknown>>; experience?: Array<Record<string, unknown>>; education?: Array<Record<string, unknown>>; projects?: Array<Record<string, unknown>>; certifications?: Array<Record<string, unknown>>; links?: Array<Record<string, unknown>>; updatedAt?: string }
export interface Cv { id: string; name: string; description?: string; selectedItems?: Record<string, string[]>; currentVersionId?: string; createdAt: string; updatedAt: string }
export interface CvVersion { id: string; cvId: string; version: number; content: Record<string, unknown>; createdAt: string }
export interface Job { id: string; company: string; title: string; location?: string; url?: string; description?: string; requirements?: string[]; salary?: Record<string, unknown>; notes?: string; createdAt: string; updatedAt: string }
export interface Application { id: string; jobId: string; cvId?: string; cvVersionId?: string; status: ApplicationStatus; notes?: string; createdAt: string; updatedAt: string }
export interface ApplicationHistory { id: string; fromStatus?: ApplicationStatus; toStatus: ApplicationStatus; notes?: string; createdAt: string }

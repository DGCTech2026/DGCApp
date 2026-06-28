import { prisma } from '../../infra/db';
import { NotFound, Forbidden, BadRequest } from '../../utils/errors';
import type { CreateEventInput } from './events.schema';

const EVENT_SELECT = {
  id: true,
  title: true,
  description: true,
  location: true,
  startsAt: true,
  endsAt: true,
  branchId: true,
  clusterId: true,
  createdById: true,
  createdAt: true,
  branch: { select: { id: true, name: true } },
  cluster: { select: { id: true, name: true } },
  _count: { select: { rsvps: true } },
};

// Branch event → branch ADMIN; cluster event → cluster MODERATOR; global → SUPER_ADMIN.
async function assertCanCreate(userId: string, role: string, branchId?: string, clusterId?: string) {
  if (role === 'SUPER_ADMIN') return;
  if (branchId) {
    const m = await prisma.branchMembership.findUnique({ where: { userId_branchId: { userId, branchId } } });
    if (m?.role === 'ADMIN') return;
    throw Forbidden('Only branch admins can create branch events');
  }
  if (clusterId) {
    const m = await prisma.clusterMembership.findUnique({ where: { userId_clusterId: { userId, clusterId } } });
    if (m?.role === 'MODERATOR') return;
    throw Forbidden('Only cluster moderators can create cluster events');
  }
  throw Forbidden('Only super admins can create global events');
}

export const eventService = {
  // Upcoming events relevant to the user: global + their branches + their clusters.
  async listUpcoming(userId: string) {
    const [branches, clusters] = await Promise.all([
      prisma.branchMembership.findMany({ where: { userId }, select: { branchId: true } }),
      prisma.clusterMembership.findMany({ where: { userId }, select: { clusterId: true } }),
    ]);
    const branchIds = branches.map((b) => b.branchId);
    const clusterIds = clusters.map((c) => c.clusterId);

    const events = await prisma.event.findMany({
      where: {
        startsAt: { gte: new Date() },
        OR: [
          { branchId: null, clusterId: null },
          ...(branchIds.length ? [{ branchId: { in: branchIds } }] : []),
          ...(clusterIds.length ? [{ clusterId: { in: clusterIds } }] : []),
        ],
      },
      orderBy: { startsAt: 'asc' },
      take: 50,
      select: EVENT_SELECT,
    });

    const mine = await prisma.eventRSVP.findMany({
      where: { userId, eventId: { in: events.map((e) => e.id) } },
      select: { eventId: true, status: true },
    });
    const map = new Map(mine.map((r) => [r.eventId, r.status]));
    return events.map((e) => ({ ...e, myRsvp: map.get(e.id) ?? null }));
  },

  async get(userId: string, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: EVENT_SELECT });
    if (!event) throw NotFound('Event not found');

    const grouped = await prisma.eventRSVP.groupBy({ by: ['status'], where: { eventId }, _count: true });
    const rsvpCounts: Record<'GOING' | 'INTERESTED' | 'NOT_GOING', number> = { GOING: 0, INTERESTED: 0, NOT_GOING: 0 };
    for (const g of grouped) rsvpCounts[g.status] = g._count;

    const mine = await prisma.eventRSVP.findUnique({
      where: { eventId_userId: { eventId, userId } },
      select: { status: true, checkedInAt: true },
    });
    return { ...event, rsvpCounts, myRsvp: mine?.status ?? null, checkedInAt: mine?.checkedInAt ?? null };
  },

  async create(userId: string, role: string, dto: CreateEventInput) {
    if (dto.branchId && dto.clusterId) throw BadRequest('An event targets a branch OR a cluster, not both');
    if (dto.branchId) {
      const b = await prisma.branch.findUnique({ where: { id: dto.branchId }, select: { id: true } });
      if (!b) throw BadRequest('Branch not found');
    }
    if (dto.clusterId) {
      const c = await prisma.cluster.findUnique({ where: { id: dto.clusterId }, select: { id: true } });
      if (!c) throw BadRequest('Cluster not found');
    }
    await assertCanCreate(userId, role, dto.branchId, dto.clusterId);

    return prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        location: dto.location ?? null,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt ?? null,
        branchId: dto.branchId ?? null,
        clusterId: dto.clusterId ?? null,
        createdById: userId,
      },
      select: EVENT_SELECT,
    });
  },

  async rsvp(userId: string, eventId: string, status: 'GOING' | 'INTERESTED' | 'NOT_GOING') {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw NotFound('Event not found');
    await prisma.eventRSVP.upsert({
      where: { eventId_userId: { eventId, userId } },
      create: { eventId, userId, status },
      update: { status },
    });
    return { ok: true };
  },

  // QR check-in: the QR encodes the event id; scanning hits this endpoint.
  async checkIn(userId: string, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw NotFound('Event not found');
    const checkedInAt = new Date();
    await prisma.eventRSVP.upsert({
      where: { eventId_userId: { eventId, userId } },
      create: { eventId, userId, status: 'GOING', checkedInAt },
      update: { checkedInAt },
    });
    return { ok: true, checkedInAt };
  },
};

import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { authenticateToken } from '../modules/auth/auth.middleware';
import { UnauthorizedError } from '../utils/errors';
import type { PublicUser } from '../modules/users/user.model';

/** Room names. Clients never choose them: the server puts each socket in the rooms its verified identity allows. */
export const rooms = {
  admin: 'admin',
  /** Every manager: used only for events about leads that are not assigned yet (any manager may pick them up). */
  managers: 'managers',
  manager: (id: string) => `manager:${id}`,
  executive: (id: string) => `executive:${id}`,
  /** One room per user, for notification:new (any role). */
  user: (id: string) => `user:${id}`,
} as const;

interface SocketData {
  user: PublicUser;
}

let io: Server | null = null;

/** The running Socket.IO server, or null before startup (events are then silently skipped, e.g. in scripts). */
export const getIo = (): Server | null => io;

function roomsFor(user: PublicUser): string[] {
  const own = [rooms.user(user.id)];
  if (user.role === 'ADMIN') return [...own, rooms.admin];
  if (user.role === 'MANAGER') return [...own, rooms.managers, rooms.manager(user.id)];
  return [...own, rooms.executive(user.id)];
}

function tokenOf(socket: Socket): string | null {
  const auth = socket.handshake.auth?.token;
  if (typeof auth === 'string' && auth) return auth.replace(/^Bearer\s+/i, '');
  const header = /^Bearer\s+(\S+)$/i.exec(socket.handshake.headers.authorization ?? '');
  return header ? header[1] : null;
}

/**
 * Attaches Socket.IO to the existing HTTP server. It is an extra delivery channel only: REST stays the way to
 * read and change data, PostgreSQL stays the source of truth, and nothing here decides who gets a lead.
 */
export function initSocketServer(httpServer: HttpServer): Server {
  if (io) return io;
  const server = new Server(httpServer, {
    // No origins configured => no CORS headers (same-origin only), like the REST API.
    cors: env.socketCorsOrigins.length > 0 ? { origin: env.socketCorsOrigins, methods: ['GET', 'POST'] } : undefined,
    serveClient: false,
  });

  // The same token check as the REST API (signature, expiry, active user, role, password change).
  server.use(async (socket, next) => {
    try {
      const token = tokenOf(socket);
      if (!token) throw new UnauthorizedError('Authentication token missing');
      const { user, expiresAt } = await authenticateToken(token);
      (socket.data as SocketData).user = user;
      socket.data.expiresAt = expiresAt;
      next();
    } catch (err) {
      const message = (err as { statusCode?: number; message?: string }).statusCode === 401 ? (err as Error).message : 'Authentication failed';
      console.warn(`Socket auth failed: ${message}`);
      next(new Error(message));
    }
  });

  server.on('connection', (socket) => {
    const { user } = socket.data as SocketData;
    for (const room of roomsFor(user)) void socket.join(room);
    console.log(`Socket connected: ${user.role} ${user.id} (${socket.id}), rooms: ${roomsFor(user).join(', ')} [${server.engine.clientsCount} connection(s) total]`);

    // A connection never outlives its token: the client reconnects with a fresh one.
    const ms = (socket.data.expiresAt as Date).getTime() - Date.now();
    const expiry = setTimeout(() => {
      socket.emit('auth:expired');
      socket.disconnect(true);
    }, Math.min(Math.max(ms, 0), 2 ** 31 - 1));
    expiry.unref();

    // Clients only listen. Anything they send is ignored, and logged so a misbehaving client is easy to spot.
    socket.onAny((event) => console.warn(`Socket client event ignored: "${String(event).slice(0, 50)}" from ${user.id} (${socket.id})`));

    socket.on('disconnect', (reason) => {
      clearTimeout(expiry);
      console.log(`Socket disconnected: ${user.id} (${socket.id}): ${reason}`);
    });
  });

  io = server;
  return server;
}

/** Ids of the connected sockets in any of these rooms (each counted once). */
const clientsIn = (server: Server, to: string[]): number => {
  const ids = new Set<string>();
  for (const room of to) for (const id of server.sockets.adapter.rooms.get(room) ?? []) ids.add(id);
  return ids.size;
};

/**
 * The one place events leave the server, so every emit is logged the same way: event, what it is about
 * (ids only, never customer details or tokens), the rooms, and how many connected clients actually got it.
 */
export function emitTo(event: string, to: string[], payload: unknown, about = ''): void {
  const server = io;
  const targets = [...new Set(to)];
  if (!server || targets.length === 0) return;
  server.to(targets).emit(event, payload);
  console.log(`Socket emit: ${event}${about ? ` ${about}` : ''} -> [${targets.join(', ')}] (${clientsIn(server, targets)} client(s))`);
}

/** Closes every connection and the HTTP server underneath. */
export async function closeSocketServer(): Promise<void> {
  const current = io;
  io = null;
  if (current) await current.close();
}

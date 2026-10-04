import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cookie from 'cookie';
import { eq } from 'drizzle-orm';
import { getDb } from '../core/db';
import { ACCESS_COOKIE_NAME, verifyToken } from '../core/security';
import { incidents, type UserRole } from '../db/schema';
import type { IncidentDto } from '../schemas/incident';
import { getHydratedIncident } from './incidentService';

export interface WsClientMeta {
  ws: WebSocket;
  userId?: string;
  role?: UserRole;
  contactToken?: string;
  subscribedIncidentId?: string;
}

const clients = new Set<WsClientMeta>();

function parseAuthFromRequest(req: http.IncomingMessage): {
  userId?: string;
  role?: UserRole;
  contactToken?: string;
} {
  let userId: string | undefined;
  let role: UserRole | undefined;
  let contactToken: string | undefined;

  try {
    const rawCookie = req.headers.cookie;
    if (rawCookie) {
      const parsedCookies = cookie.parse(rawCookie);
      const token = parsedCookies[ACCESS_COOKIE_NAME];
      if (token) {
        const decoded = verifyToken(token, 'access');
        userId = decoded.sub;
        role = decoded.role;
      }
    }
  } catch {
    // ignore invalid cookie token
  }

  try {
    if (req.headers.authorization?.startsWith('Bearer ')) {
      const bearer = req.headers.authorization.slice(7).trim();
      const decoded = verifyToken(bearer, 'access');
      userId = decoded.sub;
      role = decoded.role;
    }
  } catch {
    // ignore invalid bearer token
  }

  try {
    if (req.url) {
      const urlObj = new URL(req.url, 'http://localhost');
      const queryToken = urlObj.searchParams.get('token');
      const queryContactToken = urlObj.searchParams.get('contact_token');
      if (queryContactToken) {
        contactToken = queryContactToken;
      }
      if (!userId && queryToken) {
        try {
          const decoded = verifyToken(queryToken, 'access');
          userId = decoded.sub;
          role = decoded.role;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore URL parse error
  }

  return { userId, role, contactToken };
}

export function maskIncidentForOwner(incident: IncidentDto): IncidentDto {
  if (!incident.is_duress) {
    return incident;
  }

  const cancelEvent = incident.events?.find((e) =>
    e.note?.includes('Duress PIN supplied')
  );
  const closedAt =
    incident.closed_at || cancelEvent?.created_at || new Date().toISOString();

  const maskedEvents = incident.events
    ? incident.events
        .filter((e) => {
          if (cancelEvent && e.created_at > cancelEvent.created_at) {
            return false;
          }
          return true;
        })
        .map((e) => {
          if (e.note?.includes('Duress PIN supplied')) {
            return {
              ...e,
              to_status: 'CANCELLED' as const,
              note: 'Cancelled by user within cancel window',
            };
          }
          return e;
        })
    : undefined;

  return {
    ...incident,
    status: 'CANCELLED',
    activated_at: null,
    closed_at: closedAt,
    is_duress: false,
    needs_user_action: false,
    escalation_stage: 0,
    ...(maskedEvents ? { events: maskedEvents } : {}),
    ...(incident.notifications ? { notifications: [] } : {}),
  };
}

export function registerWebSocketClient(
  ws: WebSocket,
  req: http.IncomingMessage,
  subscribedIncidentId?: string
): WsClientMeta {
  const auth = parseAuthFromRequest(req);
  const meta: WsClientMeta = {
    ws,
    userId: auth.userId,
    role: auth.role,
    contactToken: auth.contactToken,
    subscribedIncidentId,
  };
  clients.add(meta);

  ws.on('close', () => {
    clients.delete(meta);
  });

  return meta;
}

export function broadcastIncidentUpdate(realIncident: IncidentDto): void {
  const ownerView = maskIncidentForOwner(realIncident);

  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) {
      continue;
    }

    if (
      client.subscribedIncidentId &&
      client.subscribedIncidentId !== realIncident.id
    ) {
      continue;
    }

    const isOwner =
      client.userId === realIncident.user_id &&
      client.role !== 'responder' &&
      client.role !== 'admin';

    const payloadIncident = isOwner ? ownerView : realIncident;

    client.ws.send(
      JSON.stringify({
        type: 'incident_updated',
        incident: payloadIncident,
        timestamp: new Date().toISOString(),
      })
    );
  }
}

const INCIDENT_WS_REGEX = /^\/(?:api\/)?ws\/incidents\/([^/?#]+)$/;

export function attachWebSocketHub(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    const pathname = request.url ? request.url.split('?')[0] : '';

    if (pathname === '/ws' || pathname === '/api/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        registerWebSocketClient(ws, request);
        ws.send(
          JSON.stringify({
            type: 'connected',
            service: 'saathi-ws',
            timestamp: new Date().toISOString(),
          })
        );
      });
      return;
    }

    const match = pathname.match(INCIDENT_WS_REGEX);
    if (match) {
      const incidentId = decodeURIComponent(match[1]);
      const auth = parseAuthFromRequest(request);

      if (!auth.userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      try {
        const db = getDb();
        const [inc] = await db
          .select()
          .from(incidents)
          .where(eq(incidents.id, incidentId))
          .limit(1);

        if (!inc) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        if (inc.userId !== auth.userId) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }

        const initialOwnerDto = await getHydratedIncident(
          db,
          incidentId,
          auth.userId,
          { viewerRole: 'owner' }
        );

        wss.handleUpgrade(request, socket, head, (ws) => {
          registerWebSocketClient(ws, request, incidentId);
          // Reconnect-safe: immediately send current state on connect
          ws.send(
            JSON.stringify({
              type: 'incident_state',
              incident: initialOwnerDto,
              timestamp: new Date().toISOString(),
            })
          );
        });
      } catch {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    }
  });

  return wss;
}

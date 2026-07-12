// WebSocket server broadcasting Hermes events to subscribed workspace clients
// (ARCHITECTURE.md §6). Transport-agnostic on the inbound side: it consumes domain
// events via the injected IEventSubscriber port (Group 6 wires this to the Redis
// event broker subscription); the outbound side is the `ws` protocol.
//
// Client protocol: after connecting to `/api/hermes/live`, a client sends
//   { "type": "subscribe", "workspaceId": "<id>" }
// to scope the stream to its workspace. Events are then pushed as
//   { "type": <domainEventType>, "data": <payload>, "occurredAt": <iso> }

import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { DomainEvent } from '../../domain/ports/IEventPublisher';

export interface IEventSubscriber {
  // Registers a handler for domain events; returns an unsubscribe function.
  subscribe(handler: (event: DomainEvent) => void): () => void;
}

export interface HermesLiveUpdatesDeps {
  subscriber?: IEventSubscriber;
  path?: string;
}

interface ClientMeta {
  workspaceId?: string;
}

export class HermesLiveUpdates {
  private wss?: WebSocketServer;
  private unsubscribe?: () => void;
  private readonly clients = new Map<WebSocket, ClientMeta>();

  constructor(private readonly deps: HermesLiveUpdatesDeps = {}) {}

  attach(server: Server): void {
    const wss = new WebSocketServer({
      server,
      path: this.deps.path ?? '/api/hermes/live',
    });
    this.wss = wss;

    wss.on('connection', (socket: WebSocket) => {
      this.clients.set(socket, {});
      socket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            type?: string;
            workspaceId?: string;
          };
          if (msg?.type === 'subscribe' && typeof msg.workspaceId === 'string') {
            this.clients.set(socket, { workspaceId: msg.workspaceId });
          }
        } catch {
          // Ignore malformed client messages.
        }
      });
      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', () => this.clients.delete(socket));
    });

    if (this.deps.subscriber) {
      this.unsubscribe = this.deps.subscriber.subscribe((event) =>
        this.broadcast(event),
      );
    }
  }

  broadcast(event: DomainEvent): void {
    const rawWorkspace = event.payload?.workspaceId;
    const workspaceId = typeof rawWorkspace === 'string' ? rawWorkspace : undefined;
    const message = JSON.stringify({
      type: event.type,
      data: event.payload,
      occurredAt: event.occurredAt,
    });
    for (const [socket, meta] of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      // If both the event and the client are workspace-scoped, only deliver on match.
      if (workspaceId && meta.workspaceId && meta.workspaceId !== workspaceId) continue;
      socket.send(message);
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const socket of this.clients.keys()) {
      socket.close();
    }
    this.clients.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    this.wss = undefined;
  }
}

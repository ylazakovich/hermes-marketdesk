// Verifies the Hermes WebSocket server delivers workspace-scoped events end to end
// over a real ws connection and honours workspace filtering.

import http from 'http';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { HermesLiveUpdates } from '../websocket/HermesLiveUpdates';
import type { DomainEvent } from '../../domain/ports/IEventPublisher';

function makeEvent(workspaceId: string): DomainEvent {
  return {
    type: 'hermes.event.created',
    aggregateType: 'hermes_event',
    aggregateId: 'e1',
    payload: { workspaceId, title: 'Price drop suggested' },
    occurredAt: new Date(),
  };
}

async function open(url: string, workspaceId: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  ws.send(JSON.stringify({ type: 'subscribe', workspaceId }));
  // Allow the subscribe message to be processed server-side.
  await new Promise((r) => setTimeout(r, 20));
  return ws;
}

describe('HermesLiveUpdates', () => {
  let server: http.Server;
  let live: HermesLiveUpdates;
  let url: string;

  beforeEach(async () => {
    server = http.createServer();
    live = new HermesLiveUpdates();
    live.attach(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}/api/hermes/live`;
  });

  afterEach(async () => {
    await live.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('broadcasts an event to a client subscribed to the matching workspace', async () => {
    const ws = await open(url, 'ws-1');
    const received = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (raw) => resolve(JSON.parse(raw.toString())));
    });

    live.broadcast(makeEvent('ws-1'));

    const message = await received;
    expect(message.type).toBe('hermes.event.created');
    expect((message.data as { workspaceId: string }).workspaceId).toBe('ws-1');
    ws.close();
  });

  it('does not deliver events for a different workspace', async () => {
    const ws = await open(url, 'ws-1');
    let delivered = false;
    ws.on('message', () => {
      delivered = true;
    });

    live.broadcast(makeEvent('ws-2'));
    await new Promise((r) => setTimeout(r, 40));

    expect(delivered).toBe(false);
    ws.close();
  });
});

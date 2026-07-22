import { DismissHermesEventUseCase } from '../usecases/DismissHermesEventUseCase';
import { HermesEvent } from '../../domain/entities/HermesEvent';
import {
  InMemoryEventRepository,
  RecordingEventPublisher,
  unwrap,
} from '../../domain/testkit/support';
import { InMemoryActivityLogRepository, idFactory } from '../testkit/support';

function setup() {
  const eventRepo = new InMemoryEventRepository();
  const activityLog = new InMemoryActivityLogRepository();
  const publisher = new RecordingEventPublisher();
  const useCase = new DismissHermesEventUseCase(
    eventRepo,
    activityLog,
    publisher,
    idFactory('dismiss'),
  );
  return { useCase, eventRepo, activityLog, publisher };
}

describe('DismissHermesEventUseCase', () => {
  it('dismisses authoritatively when recommendation provenance timestamping fails', async () => {
    const { useCase, eventRepo, activityLog, publisher } = setup();
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-dismiss-provenance',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_better_title',
        severity: 'info',
        title: 'Improve title',
        proposedChange: { kind: 'title', field: 'title', from: 'Lamp', to: 'Better Lamp' },
      }),
    );
    await eventRepo.save(event);
    jest
      .spyOn(eventRepo, 'markAgentRecommendationDismissed')
      .mockRejectedValueOnce(new Error('provenance write failed'));

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
      reason: 'Not useful',
    });

    expect(result.isOk()).toBe(true);
    expect((await eventRepo.findById(event.id))?.status).toBe('dismissed');
    expect(activityLog.entries.map((entry) => entry.action)).toEqual(['hermes_event.dismissed']);
    expect(publisher.published.map((published) => published.type)).toEqual([
      'hermes.event.dismissed',
    ]);
  });
});

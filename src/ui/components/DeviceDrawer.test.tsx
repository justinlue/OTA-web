import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { OtaEngine } from '../../engine/engine';
import { DEFAULT_SETTINGS } from '../../engine/settings';
import { EngineContext } from '../hooks';
import { DeviceDrawer } from './DeviceDrawer';

const fw = { version: '2.0.0', url: 'u', sha256: 's', size: 1, models: [], notes: '' };

function engineWithFailure() {
  const engine = new OtaEngine(DEFAULT_SETTINGS, () => {
    throw new Error('not used');
  });
  const clientId = engine.store.getState().clientId;
  const now = Date.now();
  engine.store.setState({
    now,
    devices: new Map([
      [
        'd1',
        {
          id: 'd1',
          status: { online: true, fw: '1.0.0', model: 'LT-100', ts: now },
          ota: { jobId: 'b1:d1:1', phase: 'failed', ts: now, error: { code: 'LOW_BATTERY', message: 'battery 9%', phase: 'accepted' } },
        },
      ],
    ]),
    batches: new Map([
      [
        'b1',
        {
          id: 'b1', name: 'Wave 1', createdAt: now, createdBy: 'Ann', firmware: fw, maxInFlight: 5,
          allowDowngrade: false, archived: false, rev: 1, writer: clientId,
          entries: { d1: { state: 'dispatched', jobId: 'b1:d1:1', sentAt: now, attempts: 1 } },
        },
      ],
    ]),
    leases: new Map([['b1', { owner: clientId, operator: 'Ann', heartbeat: now }]]),
    history: new Map([['d1', [{ ts: now, phase: 'failed', code: 'LOW_BATTERY' }]]]),
  });
  return engine;
}

describe('DeviceDrawer', () => {
  it('shows the failure cause and retries the device', async () => {
    const engine = engineWithFailure();
    render(
      <EngineContext.Provider value={engine}>
        <DeviceDrawer deviceId="d1" onClose={() => {}} />
      </EngineContext.Provider>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('LOW_BATTERY');
    expect(alert).toHaveTextContent('Battery too low');
    expect(alert).toHaveTextContent('battery 9%');
    expect(alert).toHaveTextContent('Accepted');
    expect(screen.getByText('Wave 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    // Re-queued and immediately re-sent as attempt 2.
    expect(engine.store.getState().batches.get('b1')?.entries.d1).toMatchObject({ state: 'dispatched', jobId: 'b1:d1:2', attempts: 2 });
  });

  it('disables actions when another live tab owns the batch', () => {
    const engine = engineWithFailure();
    engine.store.setState({ leases: new Map([['b1', { owner: 'someone-else', operator: 'Bob', heartbeat: Date.now() }]]) });
    render(
      <EngineContext.Provider value={engine}>
        <DeviceDrawer deviceId="d1" onClose={() => {}} />
      </EngineContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });
});

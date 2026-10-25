// Smoke test: the whole app against the simulator, driven the way an operator would.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OtaEngine } from '../engine/engine';
import { DEFAULT_SETTINGS, type Settings } from '../engine/settings';
import { App } from './App';
import { EngineContext } from './hooks';

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  sim: { count: 24, flapRate: 0, failureRate: 0.3, speed: 2000, seed: 7 },
};

// jsdom has no layout; give scroll containers a height so the virtualizer renders rows.
const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 2000 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
});
afterAll(() => {
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
});

describe('App on the simulator', () => {
  it('connects, starts a batch, follows it to completion and shows failure causes', async () => {
    const user = userEvent.setup();
    const engine = new OtaEngine(settings);
    location.hash = '#/settings';
    render(
      <EngineContext.Provider value={engine}>
        <App />
      </EngineContext.Provider>,
    );

    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(screen.getByText('24 of 24 devices')).toBeInTheDocument());
    expect(location.hash).toBe('#/devices');

    // Narrow to LT-100 and select them all.
    await user.selectOptions(screen.getByLabelText('Model filter'), 'LT-100');
    expect(screen.getByText('12 of 24 devices')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all matching (12)' }));

    await user.click(screen.getByRole('button', { name: 'Start OTA… (12)' }));
    const dialog = screen.getByRole('dialog');
    // The simulator catalog offers 1.5.0 for LT-100; it is preselected as the best fit.
    expect(within(dialog).getByRole('combobox')).toHaveValue('1.5.0');
    expect(within(dialog).getByText(/will be updated/)).toBeInTheDocument();
    await user.clear(within(dialog).getByRole('spinbutton'));
    await user.type(within(dialog).getByRole('spinbutton'), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Start OTA' }));

    expect(location.hash).toMatch(/^#\/batches\/b-/);
    await waitFor(() => expect(screen.getByText('This tab is dispatching this batch.')).toBeInTheDocument());

    // Run until every device reaches a terminal state (NO_ACK needs the ack timeout).
    act(() => engine.updateSettings({ timeouts: { ...settings.timeouts, ackMs: 1500 } }));
    const batchId = decodeURIComponent(location.hash.split('/')[2]);
    await waitFor(
      () => {
        const views = [...engine.views(batchId).values()];
        expect(views.length).toBe(12);
        expect(views.every((v) => v.terminal)).toBe(true);
      },
      { timeout: 15_000, interval: 200 },
    );
    const views = [...engine.views(batchId).values()];
    const failed = views.filter((v) => v.state === 'failed');
    expect(views.some((v) => v.state === 'success')).toBe(true);
    expect(failed.length).toBeGreaterThan(0);
    for (const v of failed) expect(v.error?.code).toMatch(/^[A-Z_]+$/);

    // The failure count reaches the tab title and the failed counter filters the table.
    await waitFor(() => expect(document.title).toBe(`(${failed.length}) OTA`));
    await user.click(screen.getByRole('tab', { name: /Failed/ }));
    const firstFailedRow = (await screen.findAllByText(/^Failed: [A-Z_]+$/))[0];
    await user.click(firstFailedRow);
    const drawer = screen.getByRole('complementary');
    expect(within(drawer).getByRole('alert')).toHaveTextContent(/[A-Z_]{4,}/);

    // Retry from the drawer sends a second attempt.
    const failedId = within(drawer).getByRole('heading', { level: 2 }).textContent!;
    await user.click(within(drawer).getByRole('button', { name: 'Retry' }));
    expect(engine.store.getState().batches.get(batchId)?.entries[failedId].attempts).toBe(2);

    // Other views render.
    await user.click(screen.getByRole('link', { name: /^Batches/ }));
    expect((await screen.findAllByRole('link', { name: /1\.5\.0 × 12/ })).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('link', { name: 'Firmware' }));
    expect(screen.getByText('Firmware catalog')).toBeInTheDocument();
    expect(screen.getAllByText('LT-100').length).toBeGreaterThan(0);

    await act(() => engine.disconnect());
  }, 30_000);
});

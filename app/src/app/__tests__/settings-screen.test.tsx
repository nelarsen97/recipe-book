import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SettingsScreen from '@/app/settings';
import { loadSettings, saveSettings } from '@/lib/settings';
import { syncNow } from '@/lib/sync';

jest.mock('@/lib/sync', () => ({
  syncNow: jest.fn().mockResolvedValue({ ok: true, pending: 0 }),
}));

const fetchMock = jest.fn();
(globalThis as { fetch: unknown }).fetch = fetchMock;

it('shows the toggle off by default and hides the server fields', async () => {
  await render(<SettingsScreen />);

  const toggle = await screen.findByTestId('server-toggle');
  expect(toggle.props.value).toBe(false);
  expect(screen.queryByText('Server address')).toBeNull();
  expect(screen.queryByText('API key')).toBeNull();
});

it('enabling the toggle persists it, reveals the fields, and kicks off a sync', async () => {
  await render(<SettingsScreen />);

  await fireEvent(await screen.findByTestId('server-toggle'), 'valueChange', true);

  await screen.findByText('Server address');
  expect(screen.getByText('API key')).toBeTruthy();
  expect(screen.getByText('Test connection')).toBeTruthy();
  await waitFor(async () => expect((await loadSettings()).serverEnabled).toBe(true));
  expect(syncNow).toHaveBeenCalled();
});

it('disabling the toggle persists it and hides the fields again', async () => {
  await saveSettings({ serverEnabled: true, serverUrl: 'http://srv', apiKey: 'k' });
  await render(<SettingsScreen />);

  await screen.findByText('Server address');
  await fireEvent(screen.getByTestId('server-toggle'), 'valueChange', false);

  await waitFor(() => expect(screen.queryByText('Server address')).toBeNull());
  await waitFor(async () => expect((await loadSettings()).serverEnabled).toBe(false));
});

it('saves the server address (normalized) and trimmed API key', async () => {
  await saveSettings({ serverEnabled: true, serverUrl: '', apiKey: '' });
  await render(<SettingsScreen />);

  await fireEvent.changeText(
    await screen.findByPlaceholderText('http://192.168.1.20:8000'),
    'example.com/'
  );
  await fireEvent.changeText(
    screen.getByPlaceholderText("the API_KEY from the server's .env"),
    '  secret  '
  );
  await fireEvent.press(screen.getByText('Save'));

  await screen.findByText('Saved.');
  expect(await loadSettings()).toEqual({
    serverEnabled: true,
    serverUrl: 'http://example.com',
    apiKey: 'secret',
  });
});

it('asks for a server address before testing the connection', async () => {
  await saveSettings({ serverEnabled: true, serverUrl: '', apiKey: '' });
  await render(<SettingsScreen />);

  await fireEvent.press(await screen.findByText('Test connection'));

  await screen.findByText('Enter a server address first.');
  expect(fetchMock).not.toHaveBeenCalled();
});

describe('test connection outcomes', () => {
  beforeEach(async () => {
    await saveSettings({ serverEnabled: true, serverUrl: 'http://srv', apiKey: 'k' });
  });

  const jsonResponse = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it('reports an unreachable server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await render(<SettingsScreen />);

    await fireEvent.press(await screen.findByText('Test connection'));

    await screen.findByText('Could not reach the server. Check the address and your network.');
  });

  it('reports a rejected API key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    await render(<SettingsScreen />);

    await fireEvent.press(await screen.findByText('Test connection'));

    await screen.findByText('Reached the server, but it rejected the API key.');
  });

  it('reports other HTTP errors by status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    await render(<SettingsScreen />);

    await fireEvent.press(await screen.findByText('Test connection'));

    await screen.findByText('Server responded with HTTP 500.');
  });

  it('reports success when the server and Keep are healthy', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ keep: { last_error: null } }));
    await render(<SettingsScreen />);

    await fireEvent.press(await screen.findByText('Test connection'));

    await screen.findByText('Connected! Server and API key look good.');
  });

  it('warns when the server is fine but Keep reported an earlier problem', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ keep: { last_error: 'login expired' } }));
    await render(<SettingsScreen />);

    await fireEvent.press(await screen.findByText('Test connection'));

    await screen.findByText('Connected! But Keep reported a problem earlier: login expired');
  });
});

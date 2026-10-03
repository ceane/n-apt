import { transcriptApi } from '../../src/app-legal/lib/api';

describe('archive API shares backend session authorization', () => {
  beforeEach(() => { localStorage.clear(); global.fetch = jest.fn(); });
  test('refuses archive reads without a session', async () => {
    (fetch as jest.Mock).mockResolvedValue({ok:true,json:async()=>[]});
    await expect(transcriptApi.listArchives()).rejects.toThrow(/sign in|authentication/i);
    expect(fetch).not.toHaveBeenCalled();
  });
  test('sends session in Authorization, leaving it out of the URL', async () => {
    localStorage.setItem('n-apt-session-token','archive-test-token');
    (fetch as jest.Mock).mockResolvedValue({ok:true,json:async()=>[]});
    await transcriptApi.listArchives();
    expect(fetch).toHaveBeenCalledWith('/api/archives', expect.objectContaining({
      headers: expect.objectContaining({Authorization:'Bearer archive-test-token'})
    }));
  });
});
